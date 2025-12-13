import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { LocationType, ProgramCategory } from '@/generated/prisma/client';
import { BUSINESS_HOURS_24, hourSpan, VENUE_TZ } from '@/lib/businessHours';
import { add, reqFromProgram, RoleVector, ROLES } from '@/lib/roles';
import { getMaxPerLocationPerRole, getTotalPoolPerRole } from '@/lib/pools';
import { pickFirstFittingHall, type TimeWindow } from '@/lib/halls';
import { getTotalUniqueStaffCount } from '@/lib/headcount';
import { getJathaGroups, JATHA_SIZE } from '@/lib/jatha';
import { formatInTimeZone } from 'date-fns-tz';

// 15 min buffer (outside gurdwara only)
const OUTSIDE_BUFFER_MS = 15 * 60 * 1000;
const ENFORCE_WHOLE_JATHA = process.env.ENFORCE_WHOLE_JATHA === '1';
const HOUR_MS = 60 * 60 * 1000;

const BUSINESS_SLOTS_MINUTES = (() => {
  const out: number[] = [];
  for (let h = 7; h <= 19; h++) {
    out.push(h * 60);
    out.push(h * 60 + 30);
  }
  return out;
})();

function isSehajName(name: string | null | undefined) {
  return (name ?? '').toLowerCase().startsWith('sehaj path');
}

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

  if (withKirtan) {
    const lastStart = new Date(
      Math.max(start.getTime(), end.getTime() - HOUR_MS)
    );
    const secondLastStart = new Date(
      Math.max(start.getTime(), end.getTime() - 2 * HOUR_MS)
    );
    if (secondLastStart < lastStart)
      windows.push({ start: secondLastStart, end: lastStart });
    windows.push({ start: lastStart, end });
  } else {
    const closeStart = new Date(
      durMs >= 2 * HOUR_MS ? end.getTime() - HOUR_MS : firstEnd.getTime()
    );
    if (closeStart < end) windows.push({ start: closeStart, end });
  }

  return windows;
}

function hallWindowsForPrograms(
  programs: Array<{ name?: string | null }>,
  start: Date,
  end: Date
): TimeWindow[] {
  const names = (programs ?? []).map((p) => p.name ?? '');
  const hasSehaj = names.some((n) => isSehajName(n));
  if (!hasSehaj) return [{ start, end }];
  const mixed = names.some((n) => !isSehajName(n));
  if (mixed) return [{ start, end }];
  const withKirtan = names.some((n) => n.toLowerCase().includes('kirtan'));
  return hallWindowsForSehaj(start, end, withKirtan);
}

/** Convert "YYYY-MM-DD @ hour:minute in TZ" to the correct UTC Date, robust to DST. */
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
  if (offMin2 !== offMin) utc = new Date(guess.getTime() - offMin2 * 60_000);
  return utc;
}

function clipToDay(
  w: TimeWindow,
  dayStart: Date,
  dayEnd: Date
): TimeWindow | null {
  const s = w.start < dayStart ? dayStart : w.start;
  const e = w.end > dayEnd ? dayEnd : w.end;
  return e > s ? { start: s, end: e } : null;
}

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

    const clipped = clipToDay(
      { start: paddedStart, end: paddedEnd },
      dayStart,
      dayEnd
    );
    if (!clipped) continue;

    const hrs = hourSpan(clipped.start, clipped.end).filter((h) =>
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

/**
 * Returns availability for Sehaj end-times on a chosen endDate.
 * Query:
 *  - start=<ISO> (required)
 *  - endDate=YYYY-MM-DD (required)
 *  - programTypeIds=<id[,id...]> (required)
 *  - locationType=GURDWARA|OUTSIDE_GURDWARA (required)
 *  - attendees=<n> (optional)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const startIso = searchParams.get('start') ?? '';
    const endDate = searchParams.get('endDate') ?? '';
    const locationType = (searchParams.get('locationType') ?? '') as
      | LocationType
      | '';
    const attendees = Number(searchParams.get('attendees') ?? '1') || 1;

    const idsCsv = searchParams.get('programTypeIds') ?? '';
    const programTypeIds = idsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!startIso || !endDate || !locationType || programTypeIds.length === 0) {
      return NextResponse.json(
        { error: 'Missing start/endDate/locationType/programTypeIds' },
        { status: 400 }
      );
    }

    const start = new Date(startIso);
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ error: 'Invalid start ISO' }, { status: 400 });
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
        required: {},
        remainingByHour: {},
        availableByHour: {},
        hallByHour: {},
        error: 'One or more programs cannot be performed outside.',
      });
    }

    // We assume this endpoint is used for Sehaj selection; still safe if not.
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

    const trailingMax = Math.max(
      ...programs.map((p) => p.trailingKirtanMinutes ?? 0)
    );
    const jathaAllThroughCount = programs.filter(
      (p) => (p.minKirtanis ?? 0) > 0 || p.category === ProgramCategory.KIRTAN
    ).length;
    const jathaAtEndCount = programs.filter(
      (p) => (p.trailingKirtanMinutes ?? 0) > 0
    ).length;

    // End-date day boundaries in UTC
    const dayStart = zonedLocalToUtcHM(endDate, 0, 0, VENUE_TZ);
    const dayEnd = new Date(
      zonedLocalToUtcHM(ymdToNext(endDate), 0, 0, VENUE_TZ).getTime() - 1
    );

    // Overlaps that touch endDate (for staff pool usage on that day)
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
        .reduce((a: number, b: number) => a + b, 0);

      const s = new Date(b.start);
      const e = new Date(b.end);

      const bPrograms = b.items.map((it: any) => ({
        name: it.programType?.name ?? '',
      }));
      const windows = hallWindowsForPrograms(bPrograms, s, e);

      for (const w of windows) {
        const clipped = clipToDay(w, dayStart, dayEnd);
        if (!clipped) continue;

        const paddedStart =
          b.locationType === 'OUTSIDE_GURDWARA'
            ? new Date(clipped.start.getTime() - OUTSIDE_BUFFER_MS)
            : clipped.start;
        const paddedEnd =
          b.locationType === 'OUTSIDE_GURDWARA'
            ? new Date(clipped.end.getTime() + OUTSIDE_BUFFER_MS)
            : clipped.end;

        const hrs = hourSpan(paddedStart, paddedEnd).filter((h) =>
          BUSINESS_HOURS_24.includes(h)
        );

        for (const hh of hrs) {
          if (b.locationType === 'GURDWARA') {
            usedGW[hh].PATH += vec.PATH ?? 0;
            usedGW[hh].KIRTAN += vec.KIRTAN ?? 0;
            usedHeadGW[hh] += headForBooking;
          } else {
            usedOUT[hh].PATH += vec.PATH ?? 0;
            usedOUT[hh].KIRTAN += vec.KIRTAN ?? 0;
            usedHeadOUT[hh] += headForBooking;
          }
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
    const availableByHour: Record<number, boolean> = {};
    const hallByHour: Record<number, string | null> = {};

    const needsHall =
      programs.some((p) => p.requiresHall) || locationType === 'GURDWARA';

    for (const endMinutes of BUSINESS_SLOTS_MINUTES) {
      const hour24 = Math.floor(endMinutes / 60);
      const minute = endMinutes % 60;

      const endUtc = zonedLocalToUtcHM(endDate, hour24, minute, VENUE_TZ);
      if (endUtc <= start) {
        // Still return it (disabled client-side), but mark unavailable
        hours.push(endMinutes);
        remainingByHour[endMinutes] = { PATH: 0, KIRTAN: 0 };
        availableByHour[endMinutes] = false;
        hallByHour[endMinutes] = null;
        continue;
      }

      const candidateWindowsAll = hallWindowsForPrograms(
        programs as any,
        start,
        endUtc
      );
      const windowsOnEndDay = candidateWindowsAll
        .map((w) => clipToDay(w, dayStart, dayEnd))
        .filter(Boolean) as TimeWindow[];

      const spanHours = new Set<number>();
      for (const w of windowsOnEndDay) {
        const paddedStart =
          locationType === 'OUTSIDE_GURDWARA'
            ? new Date(w.start.getTime() - OUTSIDE_BUFFER_MS)
            : w.start;
        const paddedEnd =
          locationType === 'OUTSIDE_GURDWARA'
            ? new Date(w.end.getTime() + OUTSIDE_BUFFER_MS)
            : w.end;

        for (const hh of hourSpan(paddedStart, paddedEnd).filter((h) =>
          BUSINESS_HOURS_24.includes(h)
        )) {
          spanHours.add(hh);
        }
      }

      let ok = true;
      const minRem: RoleVector = {
        PATH: Number.MAX_SAFE_INTEGER,
        KIRTAN: Number.MAX_SAFE_INTEGER,
      };

      // Staff pool + headcount
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

      // Whole-jatha guard for end window
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
          const tStart = new Date(endUtc.getTime() - trailingMax * 60_000);
          const trailingHours = hourSpan(tStart, endUtc).filter((h) =>
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

      // Hall pick/check for this (start..end) based on hall windows (includes start+end windows)
      let hallPick: string | null = null;
      let hasHall = true;

      if (needsHall) {
        const hallWindows = hallWindowsForPrograms(
          programs as any,
          start,
          endUtc
        );
        hallPick = await pickFirstFittingHall(
          start,
          endUtc,
          attendees,
          hallWindows
        );
        hasHall = !!hallPick;
      }

      const hasStaff = ok;
      const finalOk = hasStaff && hasHall;

      hours.push(endMinutes);
      remainingByHour[endMinutes] = {
        PATH:
          minRem.PATH === Number.MAX_SAFE_INTEGER ? 0 : (minRem.PATH as number),
        KIRTAN:
          minRem.KIRTAN === Number.MAX_SAFE_INTEGER
            ? 0
            : (minRem.KIRTAN as number),
      };
      availableByHour[endMinutes] = finalOk;
      hallByHour[endMinutes] = hallPick;
    }

    return NextResponse.json({
      hours,
      required,
      remainingByHour,
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
