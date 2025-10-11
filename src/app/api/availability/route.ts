// src/app/api/availability/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { LocationType, ProgramCategory } from '@prisma/client';
import {
  BUSINESS_HOURS_24,
  allowedStartHoursFor,
  hourSpan,
  minSelectableHour24,
} from '@/lib/businessHours';
import { add, reqFromProgram, RoleVector, ROLES } from '@/lib/roles';
import { getMaxPerLocationPerRole, getTotalPoolPerRole } from '@/lib/pools';
import { pickFirstFreeHall } from '@/lib/halls';
import { getTotalUniqueStaffCount } from '@/lib/headcount';
import { getJathaGroups, JATHA_SIZE } from '@/lib/jatha';

// 15 min buffer (outside gurdwara only)
const OUTSIDE_BUFFER_MS = 15 * 60 * 1000;

/** Build a map hour(24)->Set<staffId> that are busy in that hour, honoring outside buffer
 * and per-assignment windows (start/end). Only counts PENDING/CONFIRMED. */
async function buildBusyByHourForDay(dayStart: Date, dayEnd: Date) {
  const busyByHour: Record<number, Set<string>> = {};
  for (const h of BUSINESS_HOURS_24) busyByHour[h] = new Set();

  const asns = await prisma.bookingAssignment.findMany({
    where: {
      booking: {
        start: { lte: dayEnd },
        end: { gte: dayStart },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
    },
    select: {
      staffId: true,
      start: true, // assignment window (may be null)
      end: true, // assignment window (may be null)
      booking: { select: { start: true, end: true, locationType: true } },
    },
  });

  for (const a of asns) {
    // prefer assignment window if present, else fall back to the booking window
    const sRaw = a.start ?? a.booking.start;
    const eRaw = a.end ?? a.booking.end;

    const s = new Date(sRaw);
    const e = new Date(eRaw);

    const paddedStart =
      a.booking.locationType === 'OUTSIDE_GURDWARA'
        ? new Date(s.getTime() - OUTSIDE_BUFFER_MS)
        : s;
    const paddedEnd =
      a.booking.locationType === 'OUTSIDE_GURDWARA'
        ? new Date(e.getTime() + OUTSIDE_BUFFER_MS)
        : e;

    const hrs = hourSpan(paddedStart, paddedEnd).filter((h) =>
      BUSINESS_HOURS_24.includes(h)
    );
    for (const h of hrs) busyByHour[h].add(a.staffId);
  }

  return busyByHour;
}

/** Count how many whole jathas (all members) are fully free in a given hour. */
function countWholeFreeJathasAtHour(
  busySet: Set<string>,
  groups: Map<string, { id: string }[]>
): number {
  let free = 0;
  for (const [_key, members] of groups) {
    const ids = members.map((m) => m.id);
    if (ids.length >= JATHA_SIZE && ids.every((id) => !busySet.has(id))) {
      free += 1;
    }
  }
  return free;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const dateStr = searchParams.get('date') ?? '';
    const locationType = (searchParams.get('locationType') ?? '') as
      | LocationType
      | '';
    const hallId = searchParams.get('hallId') || undefined;

    // Multi-select programs (fallback to single)
    const idsCsv =
      searchParams.get('programTypeIds') ||
      searchParams.get('programTypeId') ||
      '';
    const programTypeIds = idsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!dateStr || !locationType || programTypeIds.length === 0) {
      return NextResponse.json(
        { error: 'Missing date/locationType/programTypeIds' },
        { status: 400 }
      );
    }

    // Load selected programs for staffing + duration (+category for jatha rule)
    const programs = await prisma.programType.findMany({
      where: { id: { in: programTypeIds } },
      select: {
        durationMinutes: true,
        minPathers: true,
        minKirtanis: true,
        canBeOutsideGurdwara: true,
        requiresHall: true,
        peopleRequired: true,
        category: true,
        trailingKirtanMinutes: true, // NEW
      },
    });

    if (!programs.length) {
      return NextResponse.json(
        { error: 'Program types not found' },
        { status: 404 }
      );
    }

    // Location rules: outside must allow it
    if (
      locationType === 'OUTSIDE_GURDWARA' &&
      programs.some((p) => !p.canBeOutsideGurdwara)
    ) {
      return NextResponse.json({
        hours: [],
        remainingByHour: {},
        required: {},
        availableByHour: {},
        hallByHour: {},
        error: 'One or more programs cannot be performed outside.',
      });
    }

    // Required roles vector (sum of selected programs)
    const required: RoleVector = programs.reduce(
      (acc, p) => add(acc, reqFromProgram(p as any)),
      { PATH: 0, KIRTAN: 0 }
    );

    // Headcount required (peopleRequired dominates min sums)
    const headcountRequired = programs
      .map((p) =>
        Math.max(
          p.peopleRequired ?? 0,
          (p.minPathers ?? 0) + (p.minKirtanis ?? 0)
        )
      )
      .reduce((a, b) => a + b, 0);

    // How long is this block?
    const durationMinutes = Math.max(
      ...programs.map((p) => p.durationMinutes || 0)
    );
    const durationHours = Math.max(1, Math.ceil(durationMinutes / 60));

    // For jatha logic
    const trailingMax = Math.max(
      ...programs.map((p) => p.trailingKirtanMinutes ?? 0)
    );

    // Programs that need a full jatha the whole way through (pure KIRTAN / minKirtanis>0)
    const jathaAllThroughCount = programs.filter(
      (p) => (p.minKirtanis ?? 0) > 0 || p.category === ProgramCategory.KIRTAN
    ).length;

    // Programs that need a jatha only at the end (trailing window)
    const jathaAtEndCount = programs.filter(
      (p) => (p.trailingKirtanMinutes ?? 0) > 0
    ).length;

    // Special handling for very long windows
    const isLong = durationHours >= 36; // treat 36h+ as a long multi-day window
    const isPurePath = required.KIRTAN === 0;
    const isLongPath = isLong && isPurePath;

    // Multi-day window with Kirtan embedded is not supported
    if (isLong && !isPurePath) {
      return NextResponse.json({
        hours: [],
        remainingByHour: {},
        required,
        availableByHour: {},
        hallByHour: {},
        error:
          'Kirtan cannot be scheduled inside a multi-day window. Create a 48h Akhand Path booking, then a separate short Kirtan (“Samapti”) at the end.',
      });
    }

    // Candidate start hours
    const dayLocal = new Date(`${dateStr}T00:00:00`);
    let candidates = isLong
      ? [...BUSINESS_HOURS_24] // start any business-hour; end can cross days
      : allowedStartHoursFor(dayLocal, durationHours);

    // Hide past hours if querying "today"
    const minHourToday = minSelectableHour24(dayLocal, new Date());
    candidates = candidates.filter((h) => h >= minHourToday);

    // Overlaps that touch the day (both locations → shared pool math)
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999`);
    const overlaps = await prisma.booking.findMany({
      where: {
        start: { lte: dayEnd },
        end: { gte: dayStart },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      include: {
        items: {
          include: {
            programType: {
              select: {
                minPathers: true,
                minKirtanis: true,
                peopleRequired: true,
              },
            },
          },
        },
      },
    });

    // Build used vectors per hour per location, respecting outside buffer
    const usedGW: Record<number, RoleVector> = {};
    const usedOUT: Record<number, RoleVector> = {};
    for (const h of BUSINESS_HOURS_24) {
      usedGW[h] = { PATH: 0, KIRTAN: 0 };
      usedOUT[h] = { PATH: 0, KIRTAN: 0 };
    }
    const usedHeadGW: Record<number, number> = {};
    const usedHeadOUT: Record<number, number> = {};
    for (const h of BUSINESS_HOURS_24) {
      usedHeadGW[h] = 0;
      usedHeadOUT[h] = 0;
    }

    for (const b of overlaps) {
      const vec = b.items.reduce(
        (acc, it) => add(acc, reqFromProgram(it.programType as any)),
        { PATH: 0, KIRTAN: 0 }
      );

      const headForBooking = b.items
        .map((it: any) => {
          const pt: any = it.programType;
          const minSum = (pt.minPathers ?? 0) + (pt.minKirtanis ?? 0);
          return Math.max(pt.peopleRequired ?? 0, minSum);
        })
        .reduce((a: number, b: number) => a + b, 0);

      const s = new Date(b.start);
      const e = new Date(b.end);
      const paddedStart =
        b.locationType === 'OUTSIDE_GURDWARA'
          ? new Date(s.getTime() - OUTSIDE_BUFFER_MS)
          : s;
      const paddedEnd =
        b.locationType === 'OUTSIDE_GURDWARA'
          ? new Date(e.getTime() + OUTSIDE_BUFFER_MS)
          : e;

      const hrs = hourSpan(paddedStart, paddedEnd).filter((h) =>
        BUSINESS_HOURS_24.includes(h)
      );
      for (const h of hrs) {
        if (b.locationType === 'GURDWARA') {
          usedGW[h].PATH += vec.PATH ?? 0;
          usedGW[h].KIRTAN += vec.KIRTAN ?? 0;
          usedHeadGW[h] += headForBooking;
        } else {
          usedOUT[h].PATH += vec.PATH ?? 0;
          usedOUT[h].KIRTAN += vec.KIRTAN ?? 0;
          usedHeadOUT[h] += headForBooking;
        }
      }
    }

    // Busy-by-hour for whole-jatha checks + all jatha groups
    const busyByHour = await buildBusyByHourForDay(dayStart, dayEnd);
    const jathaGroups = await getJathaGroups(); // Map<'A'|'B', Staff[]>

    // Total pool & per-location caps
    const totalUniqueStaff = await getTotalUniqueStaffCount(); // unique humans
    const totalPool = await getTotalPoolPerRole(); // { PATH, KIRTAN }
    const locMax = getMaxPerLocationPerRole(locationType); // { PATH, KIRTAN }

    // Evaluate each candidate across its whole span (staff feasibility)
    const hours: number[] = [];
    const remainingByHour: Record<number, RoleVector> = {};

    for (const hStart of candidates) {
      const spanStart = new Date(
        dayLocal.getFullYear(),
        dayLocal.getMonth(),
        dayLocal.getDate(),
        hStart,
        0,
        0,
        0
      );
      const spanEnd = new Date(
        spanStart.getTime() + durationMinutes * 60 * 1000
      );

      // Staff travel buffer if OUTSIDE
      const candStart =
        locationType === 'OUTSIDE_GURDWARA'
          ? new Date(spanStart.getTime() - OUTSIDE_BUFFER_MS)
          : spanStart;
      const candEnd =
        locationType === 'OUTSIDE_GURDWARA'
          ? new Date(spanEnd.getTime() + OUTSIDE_BUFFER_MS)
          : spanEnd;

      const spanHours = hourSpan(candStart, candEnd).filter((h) =>
        BUSINESS_HOURS_24.includes(h)
      );

      const minRem: RoleVector = {
        PATH: Number.MAX_SAFE_INTEGER,
        KIRTAN: Number.MAX_SAFE_INTEGER,
      };
      let ok = true;

      if (!isLongPath) {
        // Role pool & per-location caps
        for (const hh of spanHours) {
          for (const r of ROLES) {
            const total = totalPool[r] ?? 0;
            const usedOpp =
              locationType === 'GURDWARA'
                ? (usedOUT[hh][r] ?? 0)
                : (usedGW[hh][r] ?? 0);
            const usedHere =
              locationType === 'GURDWARA'
                ? (usedGW[hh][r] ?? 0)
                : (usedOUT[hh][r] ?? 0);

            const sharedLimit = Math.max(0, total - usedOpp);
            const locLimit = Math.min(
              sharedLimit,
              (locMax as any)[r] ?? Number.MAX_SAFE_INTEGER
            );

            const remaining = Math.max(0, locLimit - usedHere);
            minRem[r] = Math.min(minRem[r] as number, remaining);

            if (remaining < (required[r] ?? 0)) ok = false;
          }
          if (!ok) break;

          // Unique headcount guard (humans, not roles)
          const usedOppHead =
            locationType === 'GURDWARA' ? usedHeadOUT[hh] : usedHeadGW[hh];
          const usedHereHead =
            locationType === 'GURDWARA' ? usedHeadGW[hh] : usedHeadOUT[hh];
          const remainingHead = Math.max(
            0,
            totalUniqueStaff - usedOppHead - usedHereHead
          );
          if (remainingHead < headcountRequired) {
            ok = false;
            break;
          }
        }
      } else {
        // Long path: we don’t enforce staff pool/headcount here.
        minRem.PATH = 0;
        minRem.KIRTAN = 0;
      }

      // Whole-jatha guard (final, single place)
      if (ok) {
        if (jathaAllThroughCount > 0) {
          // Need full jatha available for ALL hours in the span
          for (const hh of spanHours) {
            const freeJ = countWholeFreeJathasAtHour(
              busyByHour[hh],
              jathaGroups
            );
            if (freeJ < jathaAllThroughCount) {
              ok = false;
              break;
            }
          }
        } else if (jathaAtEndCount > 0 && trailingMax > 0) {
          // Need full jatha only in the trailing window
          const tStart = new Date(candEnd.getTime() - trailingMax * 60_000);
          const trailingHours = hourSpan(tStart, candEnd).filter((h) =>
            BUSINESS_HOURS_24.includes(h)
          );
          for (const hh of trailingHours) {
            const freeJ = countWholeFreeJathasAtHour(
              busyByHour[hh],
              jathaGroups
            );
            if (freeJ < jathaAtEndCount) {
              ok = false;
              break;
            }
          }
        }
      }

      // ✅ PUSH the candidate if it passed all checks
      if (ok) {
        if (minRem.PATH === Number.MAX_SAFE_INTEGER) minRem.PATH = 0;
        if (minRem.KIRTAN === Number.MAX_SAFE_INTEGER) minRem.KIRTAN = 0;
        hours.push(hStart);
        remainingByHour[hStart] = minRem;
      }
    }

    // Per-hour hall feasibility (+ which hall would be picked)
    const availableByHour: Record<number, boolean> = {};
    const hallByHour: Record<number, string | null> = {};

    const needsHall =
      programs.some((p) => p.requiresHall) || locationType === 'GURDWARA';

    for (const hStart of hours) {
      const slotStart = new Date(
        dayLocal.getFullYear(),
        dayLocal.getMonth(),
        dayLocal.getDate(),
        hStart,
        0,
        0,
        0
      );
      const slotEnd = new Date(
        slotStart.getTime() + durationMinutes * 60 * 1000
      );

      const req = required;
      const rem = remainingByHour[hStart] ?? { PATH: 0, KIRTAN: 0 };
      const hasStaff = isLongPath
        ? true // don’t block on staffing for long path windows
        : rem.PATH >= req.PATH && rem.KIRTAN >= req.KIRTAN;

      // Hall feasibility
      let hasHall = true;
      let hallPick: string | null = null;

      if (needsHall) {
        if (hallId) {
          const clash = await prisma.booking.count({
            where: {
              hallId,
              start: { lt: slotEnd },
              end: { gt: slotStart },
              status: { in: ['PENDING', 'CONFIRMED'] },
            },
          });
          hasHall = clash === 0;
          hallPick = hasHall ? hallId : null;
        } else {
          hallPick = await pickFirstFreeHall(slotStart, slotEnd);
          hasHall = !!hallPick;
        }
      }

      availableByHour[hStart] = hasStaff && hasHall;
      hallByHour[hStart] = hallPick;
    }

    return NextResponse.json({
      hours,
      remainingByHour,
      required,
      availableByHour,
      hallByHour,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unexpected error' },
      { status: 500 }
    );
  }
}
