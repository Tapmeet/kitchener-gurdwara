// src/app/api/availability/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { LocationType, ProgramCategory } from '@prisma/client';
import {
  BUSINESS_HOURS_24,
  allowedStartHoursFor,
  hourSpan,
  minSelectableHour24,
  VENUE_TZ,
} from '@/lib/businessHours';
import { add, reqFromProgram, RoleVector, ROLES } from '@/lib/roles';
import { getMaxPerLocationPerRole, getTotalPoolPerRole } from '@/lib/pools';
import { pickFirstFreeHall } from '@/lib/halls';
import { getTotalUniqueStaffCount } from '@/lib/headcount';
import { getJathaGroups, JATHA_SIZE } from '@/lib/jatha';
import { formatInTimeZone } from 'date-fns-tz';

// 15 min buffer (outside gurdwara only)
const OUTSIDE_BUFFER_MS = 15 * 60 * 1000;

/** Convert "YYYY-MM-DD @ hour:00 in TZ" to the correct UTC Date, robust to DST. */
function offsetStrToMinutes(off: string): number {
  // off like "+05:30" or "-04:00"
  const sign = off.startsWith('-') ? -1 : 1;
  const [hh, mm] = off.slice(1).split(':').map(Number);
  return sign * (hh * 60 + (mm || 0));
}
function ymdToNext(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
function zonedLocalToUtc(dateStr: string, hour24: number, tz = VENUE_TZ): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Initial guess: treat local wall-time components as if they were UTC
  let guess = new Date(Date.UTC(y, m - 1, d, hour24, 0, 0, 0));
  // Get the zone offset (e.g. "-04:00") *at that instant*
  let offMin = offsetStrToMinutes(formatInTimeZone(guess, tz, 'xxx'));
  // Apply once
  let utc = new Date(guess.getTime() - offMin * 60_000);
  // One more iteration handles DST boundaries cleanly
  const offMin2 = offsetStrToMinutes(formatInTimeZone(utc, tz, 'xxx'));
  if (offMin2 !== offMin) {
    utc = new Date(guess.getTime() - offMin2 * 60_000);
  }
  return utc;
}

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
      start: true,
      end: true,
      booking: { select: { start: true, end: true, locationType: true } },
    },
  });

  for (const a of asns) {
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

function countWholeFreeJathasAtHour(
  busySet: Set<string>,
  groups: Map<string, { id: string }[]>
): number {
  let free = 0;
  for (const [_key, members] of groups) {
    const ids = members.map((m) => m.id);
    if (ids.length >= JATHA_SIZE && ids.every((id) => !busySet.has(id)))
      free += 1;
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
        trailingKirtanMinutes: true,
      },
    });

    if (!programs.length) {
      return NextResponse.json(
        { error: 'Program types not found' },
        { status: 404 }
      );
    }

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

    const required: RoleVector = programs.reduce(
      (acc, p) => add(acc, reqFromProgram(p as any)),
      { PATH: 0, KIRTAN: 0 }
    );

    const headcountRequired = programs
      .map((p) =>
        Math.max(
          p.peopleRequired ?? 0,
          (p.minPathers ?? 0) + (p.minKirtanis ?? 0)
        )
      )
      .reduce((a, b) => a + b, 0);

    const durationMinutes = Math.max(
      ...programs.map((p) => p.durationMinutes || 0)
    );
    const durationHours = Math.max(1, Math.ceil(durationMinutes / 60));

    const trailingMax = Math.max(
      ...programs.map((p) => p.trailingKirtanMinutes ?? 0)
    );

    const jathaAllThroughCount = programs.filter(
      (p) => (p.minKirtanis ?? 0) > 0 || p.category === ProgramCategory.KIRTAN
    ).length;

    const jathaAtEndCount = programs.filter(
      (p) => (p.trailingKirtanMinutes ?? 0) > 0
    ).length;

    const isLong = durationHours >= 36;
    const isPurePath = required.KIRTAN === 0;
    const isLongPath = isLong && isPurePath;

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

    // ----- Venue-day boundaries (Toronto) in UTC -----
    const dayStart = zonedLocalToUtc(dateStr, 0, VENUE_TZ);
    const dayEnd = new Date(
      zonedLocalToUtc(ymdToNext(dateStr), 0, VENUE_TZ).getTime() - 1
    );

    // Candidate start hours (in venue TZ)
    const baseCandidates = isLong
      ? [...BUSINESS_HOURS_24]
      : allowedStartHoursFor(dayStart, durationHours);
    let candidates = baseCandidates;

    // Hide past hours if querying "today" (venue TZ)
    const minHourToday = minSelectableHour24(dayStart, new Date());
    candidates = candidates.filter((h) => h >= minHourToday);

    // Overlaps that touch the day
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

    const busyByHour = await buildBusyByHourForDay(dayStart, dayEnd);
    const jathaGroups = await getJathaGroups();

    const totalUniqueStaff = await getTotalUniqueStaffCount();
    const totalPool = await getTotalPoolPerRole();
    const locMax = getMaxPerLocationPerRole(locationType);

    const hours: number[] = [];
    const remainingByHour: Record<number, RoleVector> = {};

    for (const hStart of candidates) {
      // Build span in venue time, convert to UTC
      const spanStart = zonedLocalToUtc(dateStr, hStart, VENUE_TZ);
      const spanEnd = new Date(
        spanStart.getTime() + durationMinutes * 60 * 1000
      );

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
      const slotStart = zonedLocalToUtc(dateStr, hStart, VENUE_TZ);
      const slotEnd = new Date(
        slotStart.getTime() + durationMinutes * 60 * 1000
      );

      const req = required;
      const rem = remainingByHour[hStart] ?? { PATH: 0, KIRTAN: 0 };
      const hasStaff = isLongPath
        ? true
        : rem.PATH >= req.PATH && rem.KIRTAN >= req.KIRTAN;

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
