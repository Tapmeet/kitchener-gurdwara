// src/app/api/availability/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { LocationType, ProgramCategory } from '@/generated/prisma/client';
import {
  BUSINESS_HOURS_24,
  allowedStartHoursFor,
  hourSpan,
  minSelectableHour24,
  VENUE_TZ,
  isWithinBusinessHours,
} from '@/lib/businessHours';
import { add, reqFromProgram, RoleVector, ROLES } from '@/lib/roles';
import { getMaxPerLocationPerRole, getTotalPoolPerRole } from '@/lib/pools';
import {
  pickFirstFittingHall,
  isHallFreeForWindows,
  type TimeWindow,
} from '@/lib/halls';
import { getTotalUniqueStaffCount } from '@/lib/headcount';
import { getJathaGroups, JATHA_SIZE } from '@/lib/jatha';
import { formatInTimeZone } from 'date-fns-tz';

// 15 min buffer (outside gurdwara only)
const OUTSIDE_BUFFER_MS = 15 * 60 * 1000;
const ENFORCE_WHOLE_JATHA = process.env.ENFORCE_WHOLE_JATHA === '1';
const HOUR_MS = 60 * 60 * 1000;

function isSehajName(name: string | null | undefined) {
  return (name ?? '').toLowerCase().startsWith('sehaj path');
}

/**
 * Sehaj windows:
 * - Always: first 60 minutes
 * - Sehaj Path: last 60 minutes
 * - Sehaj Path + Kirtan: last 120 minutes (merged)
 */
function hallWindowsForSehaj(
  start: Date,
  end: Date,
  withKirtan: boolean
): TimeWindow[] {
  if (end <= start) return [];
  const firstEnd = new Date(Math.min(start.getTime() + HOUR_MS, end.getTime()));
  const windows: TimeWindow[] = [{ start, end: firstEnd }];

  const durMs = end.getTime() - start.getTime();
  if (durMs <= HOUR_MS) return windows;

  const endMinutes = withKirtan ? 2 * HOUR_MS : HOUR_MS;
  const endStart = new Date(
    Math.max(start.getTime(), end.getTime() - endMinutes)
  );
  if (endStart < end) windows.push({ start: endStart, end });

  return windows;
}

function hallWindowsForPrograms(
  programs: Array<{ name?: string | null }>,
  start: Date,
  end: Date
): TimeWindow[] | undefined {
  const names = programs.map((p) => p.name ?? '');
  const hasSehaj = names.some((n) => isSehajName(n));
  if (!hasSehaj) return undefined;
  const mixed = names.some((n) => !isSehajName(n));
  if (mixed) return undefined;
  const withKirtan = names.some((n) => n.toLowerCase().includes('kirtan'));
  return hallWindowsForSehaj(start, end, withKirtan);
}

function isBusinessStartHourTZ(d: Date) {
  const hourStr = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    hour12: false,
    timeZone: VENUE_TZ,
  }).format(d);
  const h = parseInt(hourStr, 10);
  const start = Math.min(...BUSINESS_HOURS_24);
  const end = Math.max(...BUSINESS_HOURS_24) + 1;
  return h >= start && h < end;
}

/** Convert TimeWindow[] into business-hour buckets (union), honoring outside buffer */
function hoursForWindows(
  windows: TimeWindow[],
  locationType: LocationType,
  outsideBufferMs: number
): number[] {
  const set = new Set<number>();

  for (const w of windows) {
    if (!w || w.end <= w.start) continue;

    const s =
      locationType === 'OUTSIDE_GURDWARA'
        ? new Date(w.start.getTime() - outsideBufferMs)
        : w.start;

    const e =
      locationType === 'OUTSIDE_GURDWARA'
        ? new Date(w.end.getTime() + outsideBufferMs)
        : w.end;

    for (const h of hourSpan(s, e)) {
      if (BUSINESS_HOURS_24.includes(h)) set.add(h);
    }
  }

  return Array.from(set).sort((a, b) => a - b);
}

/** Convert "YYYY-MM-DD @ hour:00 in TZ" to the correct UTC Date, robust to DST. */
function offsetStrToMinutes(off: string): number {
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
  let guess = new Date(Date.UTC(y, m - 1, d, hour24, 0, 0, 0));
  let offMin = offsetStrToMinutes(formatInTimeZone(guess, tz, 'xxx'));
  let utc = new Date(guess.getTime() - offMin * 60_000);
  const offMin2 = offsetStrToMinutes(formatInTimeZone(utc, tz, 'xxx'));
  if (offMin2 !== offMin) {
    utc = new Date(guess.getTime() - offMin2 * 60_000);
  }
  return utc;
}
function zonedLocalToUtcHM(
  dateStr: string,
  hour24: number,
  minute: number,
  tz = VENUE_TZ
): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  let guess = new Date(Date.UTC(y, m - 1, d, hour24, minute, 0, 0));
  let offMin = offsetStrToMinutes(formatInTimeZone(guess, tz, 'xxx'));
  let utc = new Date(guess.getTime() - offMin * 60_000);
  const offMin2 = offsetStrToMinutes(formatInTimeZone(utc, tz, 'xxx'));
  if (offMin2 !== offMin) {
    utc = new Date(guess.getTime() - offMin2 * 60_000);
  }
  return utc;
}

/** Build hour(24)->Set<staffId> busy map for a RANGE, honoring outside buffer and per-assignment windows. */
async function buildBusyByHourForRange(rangeStart: Date, rangeEnd: Date) {
  const busyByHour: Record<number, Set<string>> = {};
  for (const h of BUSINESS_HOURS_24) busyByHour[h] = new Set();

  const asns = await prisma.bookingAssignment.findMany({
    where: {
      booking: {
        start: { lt: rangeEnd },
        end: { gt: rangeStart },
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
    const attendees = Number(searchParams.get('attendees') ?? '1') || 1;

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
        name: true,
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
      .map((p) => {
        const minSum = (p.minPathers ?? 0) + (p.minKirtanis ?? 0);

        const isLongPathItem =
          p.category === ProgramCategory.PATH &&
          (p.durationMinutes ?? 0) >= 36 * 60 &&
          (p.minKirtanis ?? 0) === 0;

        if (isLongPathItem) return Math.max(minSum, 1);
        return Math.max(p.peopleRequired ?? 0, minSum);
      })
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

    const isSehajOnly =
      programs.length > 0 && programs.every((p) => isSehajName(p.name));

    const isLongPath = isLong && isPurePath && !isSehajOnly;

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

    // Candidate start hours (in venue TZ, coarse hours first)
    const baseCandidatesHours = isLong
      ? [...BUSINESS_HOURS_24]
      : allowedStartHoursFor(dayStart, durationHours);
    let candidateHours = baseCandidatesHours;

    // Hide past hours if querying "today" (venue TZ)
    const minHourToday = minSelectableHour24(dayStart, new Date());
    candidateHours = candidateHours.filter((h) => h >= minHourToday);

    // Expand each allowed hour into :00 and :30 minute slots (minutes since midnight)
    const candidates: number[] = [];
    for (const h of candidateHours) {
      candidates.push(h * 60);
      candidates.push(h * 60 + 30);
    }

    // Build a wide query range that covers ALL candidate slots (important for Sehaj end-window)
    const candidateStartsUtc = candidates.map((startMinutes) => {
      const hour24 = Math.floor(startMinutes / 60);
      const minute = startMinutes % 60;
      return zonedLocalToUtcHM(dateStr, hour24, minute, VENUE_TZ);
    });

    const minStartUtc =
      candidateStartsUtc.length > 0
        ? candidateStartsUtc.reduce(
            (min, d) => (d < min ? d : min),
            candidateStartsUtc[0]
          )
        : dayStart;

    const maxEndUtc =
      candidateStartsUtc.length > 0
        ? candidateStartsUtc.reduce(
            (max, d) => {
              const end = new Date(d.getTime() + durationMinutes * 60_000);
              return end > max ? end : max;
            },
            new Date(candidateStartsUtc[0].getTime() + durationMinutes * 60_000)
          )
        : dayEnd;

    const overlapStart = new Date(minStartUtc.getTime() - OUTSIDE_BUFFER_MS);
    const overlapEnd = new Date(maxEndUtc.getTime() + OUTSIDE_BUFFER_MS);

    // Overlaps that touch ANY relevant time (not just the day)
    const overlaps = await prisma.booking.findMany({
      where: {
        start: { lt: overlapEnd },
        end: { gt: overlapStart },
        status: { in: ['PENDING', 'CONFIRMED'] },
      },
      include: {
        items: {
          include: {
            programType: {
              select: {
                name: true,
                minPathers: true,
                minKirtanis: true,
                peopleRequired: true,
                durationMinutes: true,
                category: true,
              },
            },
          },
        },
      },
    });

    const usedGW: Record<number, RoleVector> = {};
    const usedOUT: Record<number, RoleVector> = {};
    const usedHeadGW: Record<number, number> = {};
    const usedHeadOUT: Record<number, number> = {};
    for (const h of BUSINESS_HOURS_24) {
      usedGW[h] = { PATH: 0, KIRTAN: 0 };
      usedOUT[h] = { PATH: 0, KIRTAN: 0 };
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

          const isLongPathItem =
            pt.category === ProgramCategory.PATH &&
            (pt.durationMinutes ?? 0) >= 36 * 60 &&
            (pt.minKirtanis ?? 0) === 0;

          if (isLongPathItem) return Math.max(minSum, 1);
          return Math.max(pt.peopleRequired ?? 0, minSum);
        })
        .reduce((a: number, bb: number) => a + bb, 0);

      const s = new Date(b.start);
      const e = new Date(b.end);

      const bPrograms = b.items.map((it: any) => ({
        name: it.programType?.name ?? '',
      }));

      // ✅ Overlap consumption: Sehaj bookings consume only their windows
      const windows = hallWindowsForPrograms(bPrograms, s, e) ?? [
        { start: s, end: e },
      ];

      const hrs = hoursForWindows(
        windows,
        b.locationType as any,
        OUTSIDE_BUFFER_MS
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

    const busyByHour = await buildBusyByHourForRange(overlapStart, overlapEnd);
    const jathaGroups = await getJathaGroups();

    const totalUniqueStaff = await getTotalUniqueStaffCount();
    const totalPool = await getTotalPoolPerRole();
    const locMax = getMaxPerLocationPerRole(locationType);

    const hours: number[] = []; // slotMinutes
    const remainingByHour: Record<number, RoleVector> = {};

    for (const startMinutes of candidates) {
      const hour24 = Math.floor(startMinutes / 60);
      const minute = startMinutes % 60;

      const spanStart = zonedLocalToUtcHM(dateStr, hour24, minute, VENUE_TZ);
      const spanEnd = new Date(spanStart.getTime() + durationMinutes * 60_000);

      // ✅ Candidate evaluation uses Sehaj windows (start+end) instead of full multi-day span
      const windows = hallWindowsForPrograms(
        programs as any,
        spanStart,
        spanEnd
      ) ?? [{ start: spanStart, end: spanEnd }];

      // --- Business-hours guard (match server rules) ---
      let ok = true;

      if (isSehajOnly) {
        for (const w of windows) {
          const bh = isWithinBusinessHours(w.start, w.end, VENUE_TZ);
          if (!bh.ok) {
            ok = false;
            break;
          }
        }
      } else if (!isLongPath) {
        const bh = isWithinBusinessHours(spanStart, spanEnd, VENUE_TZ);
        if (!bh.ok) ok = false;
      } else {
        if (!isBusinessStartHourTZ(spanStart)) ok = false;
      }

      if (!ok) continue;

      const spanHours = hoursForWindows(
        windows,
        locationType,
        OUTSIDE_BUFFER_MS
      );

      const minRem: RoleVector = {
        PATH: Number.MAX_SAFE_INTEGER,
        KIRTAN: Number.MAX_SAFE_INTEGER,
      };

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

      // Whole-jatha guard (hour-based; uses busyByHour built over full overlap range)
      if (ok && ENFORCE_WHOLE_JATHA) {
        if (jathaAllThroughCount > 0) {
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
          // trailing window should be based on actual booking end (not the outside buffer),
          // but hour blocking will still honor outside buffer via hoursForWindows.
          const tStart = new Date(spanEnd.getTime() - trailingMax * 60_000);
          const trailingWindows: TimeWindow[] = [
            { start: tStart, end: spanEnd },
          ];
          const trailingHours = hoursForWindows(
            trailingWindows,
            locationType,
            OUTSIDE_BUFFER_MS
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

      if (ok) {
        if (minRem.PATH === Number.MAX_SAFE_INTEGER) minRem.PATH = 0;
        if (minRem.KIRTAN === Number.MAX_SAFE_INTEGER) minRem.KIRTAN = 0;
        hours.push(startMinutes);
        remainingByHour[startMinutes] = minRem;
      }
    }

    // Per-slot hall feasibility (+ which hall would be picked)
    const availableByHour: Record<number, boolean> = {};
    const hallByHour: Record<number, string | null> = {};

    const needsHall =
      programs.some((p) => p.requiresHall) || locationType === 'GURDWARA';

    for (const slotMinutes of hours) {
      const hour24 = Math.floor(slotMinutes / 60);
      const minute = slotMinutes % 60;

      const slotStart = zonedLocalToUtcHM(dateStr, hour24, minute, VENUE_TZ);
      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);

      const req = required;
      const rem = remainingByHour[slotMinutes] ?? { PATH: 0, KIRTAN: 0 };

      const hasStaff = isLongPath
        ? true
        : rem.PATH >= req.PATH && rem.KIRTAN >= req.KIRTAN;

      let hasHall = true;
      let hallPick: string | null = null;

      if (needsHall) {
        const hallWindows = hallWindowsForPrograms(
          programs as any,
          slotStart,
          slotEnd
        ) ?? [{ start: slotStart, end: slotEnd }];

        if (hallId) {
          hasHall = await isHallFreeForWindows(hallId, hallWindows);
          hallPick = hasHall ? hallId : null;
        } else {
          hallPick = await pickFirstFittingHall(
            slotStart,
            slotEnd,
            attendees,
            hallWindows
          );
          hasHall = !!hallPick;
        }
      }

      availableByHour[slotMinutes] = hasStaff && hasHall;
      hallByHour[slotMinutes] = hallPick;
    }

    return NextResponse.json({
      hours, // minute slots: [420, 450, 480, ...]
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
