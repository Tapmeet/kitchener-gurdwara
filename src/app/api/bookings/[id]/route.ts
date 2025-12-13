// src/app/api/bookings/[id]/route.ts

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/db';

import {
  VENUE_TZ,
  isWithinBusinessHours,
  hourSpan,
  BUSINESS_HOURS_24,
} from '@/lib/businessHours';
import { add, reqFromProgram, RoleVector, ROLES } from '@/lib/roles';
import { getMaxPerLocationPerRole, getTotalPoolPerRole } from '@/lib/pools';
import { getTotalUniqueStaffCount } from '@/lib/headcount';
import { getJathaGroups, JATHA_SIZE } from '@/lib/jatha';
import {
  pickFirstFittingHall,
  isHallFreeForWindows,
  type TimeWindow,
} from '@/lib/halls';
import { ProgramCategory } from '@/generated/prisma/client';

const OUTSIDE_BUFFER_MS = 15 * 60 * 1000;
const ENFORCE_WHOLE_JATHA = process.env.ENFORCE_WHOLE_JATHA === '1';

const HOUR_MS = 60 * 60 * 1000;

function isSehajName(name: string | null | undefined) {
  return (name ?? '').toLowerCase().startsWith('sehaj path');
}

/**
 * Sehaj hall windows:
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

function hallWindowsForProgramNames(
  programNames: string[],
  start: Date,
  end: Date
): TimeWindow[] {
  const names = (programNames ?? []).map((n) => String(n ?? ''));
  const hasSehaj = names.some((n) => isSehajName(n));
  if (!hasSehaj) return [{ start, end }];
  const mixed = names.some((n) => !isSehajName(n));
  if (mixed) return [{ start, end }];
  const withKirtan = names.some((n) => n.toLowerCase().includes('kirtan'));
  return hallWindowsForSehaj(start, end, withKirtan);
}

/** Convert TimeWindow[] into business-hour buckets (union) */
function hoursForWindows(
  windows: TimeWindow[],
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA',
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

/** Tight range used to query overlaps when we only care about Sehaj windows */
function rangeForWindows(
  windows: TimeWindow[],
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA',
  outsideBufferMs: number
) {
  let min = Infinity;
  let max = -Infinity;

  for (const w of windows) {
    if (!w || w.end <= w.start) continue;

    const s =
      locationType === 'OUTSIDE_GURDWARA'
        ? w.start.getTime() - outsideBufferMs
        : w.start.getTime();

    const e =
      locationType === 'OUTSIDE_GURDWARA'
        ? w.end.getTime() + outsideBufferMs
        : w.end.getTime();

    if (s < min) min = s;
    if (e > max) max = e;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { start: new Date(min), end: new Date(max) };
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

/* ------------------------ GET (existing) ------------------------ */

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role as string | undefined;

  const canViewBooking = role === 'ADMIN' || role === 'STAFF';

  if (!canViewBooking) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      hall: { select: { id: true, name: true } },
      items: {
        include: {
          programType: { select: { id: true, name: true, category: true } },
        },
      },
      assignments: {
        include: {
          staff: { select: { id: true, name: true, skills: true } },
          bookingItem: {
            include: {
              programType: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!booking)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const payload = {
    id: booking.id,
    title: booking.title,
    start: booking.start,
    end: booking.end,
    locationType: booking.locationType,
    hall: booking.hall
      ? { id: booking.hall.id, name: booking.hall.name }
      : null,
    address: booking.address ?? null,
    attendees: booking.attendees,
    contactName: booking.contactName,
    contactPhone: booking.contactPhone,
    contactEmail: booking.contactEmail ?? null,
    notes: booking.notes ?? null,
    programs: booking.items
      .map((i) =>
        i.programType
          ? {
              id: i.programType.id,
              name: i.programType.name,
              category: i.programType.category,
            }
          : null
      )
      .filter(Boolean) as {
      id: string;
      name: string;
      category?: string | null;
    }[],
    assignments: booking.assignments.map((a) => ({
      id: a.id,
      staff: a.staff
        ? { id: a.staff.id, name: a.staff.name, skills: a.staff.skills }
        : null,
      programType: a.bookingItem?.programType
        ? {
            id: a.bookingItem.programType.id,
            name: a.bookingItem.programType.name,
          }
        : null,
    })),
    createdBy: booking.createdBy ?? null,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };

  return NextResponse.json(payload);
}

/* ------------------------ PATCH (fixed for Sehaj windows) ------------------------ */

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    // --- Require ADMIN ---
    const session = await getServerSession(authOptions);
    const role = (session?.user as any)?.role;
    const isAdmin = role === 'ADMIN';
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // --- Parse payload ---
    const body = await req.json().catch(() => null);
    const startStr = body?.start as string | undefined;
    const endStr = body?.end as string | undefined;

    if (!startStr) {
      return NextResponse.json(
        { error: 'start is required (ISO date string)' },
        { status: 400 }
      );
    }

    const start = new Date(startStr);
    const end = new Date(endStr ?? startStr);

    if (end <= start) {
      return NextResponse.json(
        { error: 'End time must be after the start time.' },
        { status: 400 }
      );
    }

    // --- Load booking + programs ---
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        items: { include: { programType: true } },
        hall: true,
      },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    const programs = booking.items.map((it) => it.programType);
    if (!programs.length) {
      return NextResponse.json(
        { error: 'Booking has no program items' },
        { status: 400 }
      );
    }

    const programNames = programs.map((p: any) => String(p?.name ?? ''));
    const hasSehaj = programNames.some((n) => isSehajName(n));
    const mixed = hasSehaj && programNames.some((n) => !isSehajName(n));
    const isSehajOnly = hasSehaj && !mixed;

    // Sehaj windows for this *new* start/end (or full window if not Sehaj-only)
    const sehajWindows = isSehajOnly
      ? hallWindowsForProgramNames(programNames, start, end)
      : null;

    // --- Required roles + headcount ---
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

        if (isLongPathItem) {
          // At least 1 person, no massive over-reservation
          return Math.max(minSum, 1);
        }

        return Math.max(p.peopleRequired ?? 0, minSum);
      })
      .reduce((a, b) => a + b, 0);

    // Use actual new booking window for "long" determination
    const bookingDurationMinutes = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60_000)
    );
    const durationHours = Math.max(1, Math.ceil(bookingDurationMinutes / 60));
    const isLong = durationHours >= 36;
    const isPurePath = required.KIRTAN === 0;

    // Akhand-style long path = long + pure path, but NOT Sehaj-only
    const isLongPath = isLong && isPurePath && !isSehajOnly;

    // --- Business-hours guard ---
    if (isSehajOnly) {
      for (const w of sehajWindows ?? []) {
        const bh = isWithinBusinessHours(w.start, w.end, VENUE_TZ);
        if (!bh.ok) {
          return NextResponse.json(
            { error: bh.error ?? 'Outside business hours' },
            { status: 400 }
          );
        }
      }
    } else if (!isLongPath) {
      const bh = isWithinBusinessHours(start, end, VENUE_TZ);
      if (!bh.ok) {
        return NextResponse.json(
          { error: bh.error ?? 'Outside business hours' },
          { status: 400 }
        );
      }
    } else {
      if (!isBusinessStartHourTZ(start)) {
        return NextResponse.json(
          { error: 'Start time must be during business hours (7:00–19:00).' },
          { status: 400 }
        );
      }
    }

    // Long + Kirtan not allowed (but allow Sehaj Path + Kirtan)
    if (isLong && !isPurePath && !isSehajOnly) {
      return NextResponse.json(
        {
          error:
            'Kirtan cannot be scheduled inside a multi-day window. Use a 48h Akhand Path and a separate short Kirtan at the end.',
        },
        { status: 400 }
      );
    }

    // --- Trailing-Kirtan whole-jatha guard ---
    const trailingMax = Math.max(
      ...programs.map((p) => p.trailingKirtanMinutes ?? 0)
    );

    const needsTrailingJatha = trailingMax > 0 && ENFORCE_WHOLE_JATHA;

    if (needsTrailingJatha) {
      const tStart = new Date(end.getTime() - trailingMax * 60_000);

      const busyByHour: Record<number, Set<string>> = {};
      for (const h of BUSINESS_HOURS_24) busyByHour[h] = new Set();

      const asns = await prisma.bookingAssignment.findMany({
        where: {
          booking: {
            start: { lt: end },
            end: { gt: tStart },
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

      const jathaGroups = await getJathaGroups();
      const trailingHours = hourSpan(tStart, end).filter((h) =>
        BUSINESS_HOURS_24.includes(h)
      );

      function countWholeFreeJathasAtHour(busySet: Set<string>) {
        let free = 0;
        for (const [_k, members] of jathaGroups) {
          const ids = members.map((m) => m.id);
          if (ids.length >= JATHA_SIZE && ids.every((id) => !busySet.has(id))) {
            free += 1;
          }
        }
        return free;
      }

      for (const hh of trailingHours) {
        const freeJ = countWholeFreeJathasAtHour(busyByHour[hh]);
        if (freeJ < 1) {
          return NextResponse.json(
            {
              error:
                'No full jatha is free during the trailing Kirtan window at the new time. Pick a different time/date.',
            },
            { status: 409 }
          );
        }
      }
    }

    // --- Hall availability for new time (Sehaj uses windows) ---
    let hallId = booking.hallId;

    const hallWindows = hallWindowsForProgramNames(programNames, start, end);

    if (booking.locationType === 'GURDWARA' && hallId) {
      const free = await isHallFreeForWindows(hallId, hallWindows, {
        ignoreBookingId: booking.id,
      });
      if (!free) {
        return NextResponse.json(
          {
            error:
              'Current hall is not free at the new time. Please choose a different time or hall.',
          },
          { status: 409 }
        );
      }
    }

    // Optional: if no hall yet but at Gurdwara, pick one
    if (booking.locationType === 'GURDWARA' && !hallId) {
      const attendees =
        typeof booking.attendees === 'number'
          ? Math.max(1, booking.attendees)
          : 1;
      hallId = await pickFirstFittingHall(start, end, attendees, hallWindows);
      if (!hallId) {
        return NextResponse.json(
          {
            error:
              'No suitable hall is free at that time for the attendee count.',
          },
          { status: 409 }
        );
      }
    }

    // --- Capacity + headcount (excluding this booking itself) ---
    const effectiveWindows =
      isSehajOnly && sehajWindows?.length ? sehajWindows : [{ start, end }];

    const candStart =
      booking.locationType === 'OUTSIDE_GURDWARA'
        ? new Date(start.getTime() - OUTSIDE_BUFFER_MS)
        : start;
    const candEnd =
      booking.locationType === 'OUTSIDE_GURDWARA'
        ? new Date(end.getTime() + OUTSIDE_BUFFER_MS)
        : end;

    const queryRange =
      isSehajOnly && sehajWindows?.length
        ? rangeForWindows(
            sehajWindows,
            booking.locationType as any,
            OUTSIDE_BUFFER_MS
          )
        : null;

    const overlapStart = queryRange?.start ?? candStart;
    const overlapEnd = queryRange?.end ?? candEnd;

    const hours = hoursForWindows(
      effectiveWindows,
      booking.locationType as any,
      OUTSIDE_BUFFER_MS
    );

    if (!hours.length) {
      return NextResponse.json(
        { error: 'Selected time is outside business hours.' },
        { status: 400 }
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const overlaps = await tx.booking.findMany({
        where: {
          id: { not: booking.id }, // exclude self
          start: { lt: overlapEnd },
          end: { gt: overlapStart },
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        include: {
          items: {
            include: {
              programType: {
                select: {
                  name: true, // ✅ needed to detect Sehaj windows in overlaps
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
          (acc, it: any) => add(acc, reqFromProgram(it.programType as any)),
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

        const bNames = (b.items ?? []).map((it: any) =>
          String(it.programType?.name ?? '')
        );
        const bWindows = hallWindowsForProgramNames(bNames, s, e);

        const hrs = hoursForWindows(
          bWindows,
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

      const totalUniqueStaff = await getTotalUniqueStaffCount();
      const totalPool = await getTotalPoolPerRole();
      const locMax = getMaxPerLocationPerRole(
        booking.locationType as 'GURDWARA' | 'OUTSIDE_GURDWARA'
      );

      for (const h of hours) {
        if (!isLongPath) {
          for (const r of ROLES as ReadonlyArray<keyof RoleVector>) {
            const total = totalPool[r] ?? 0;

            const usedOpp =
              booking.locationType === 'GURDWARA'
                ? (usedOUT[h][r] ?? 0)
                : (usedGW[h][r] ?? 0);

            const usedHere =
              booking.locationType === 'GURDWARA'
                ? (usedGW[h][r] ?? 0)
                : (usedOUT[h][r] ?? 0);

            const sharedLimit = Math.max(0, total - usedOpp);
            const locLimit = Math.min(
              sharedLimit,
              (locMax as any)[r] ?? Number.MAX_SAFE_INTEGER
            );

            const remaining = Math.max(0, locLimit - usedHere);
            const need = (required[r] ?? 0) as number;
            if (remaining < need) throw new Error('CAPACITY_EXCEEDED');
          }

          const usedOppHead =
            booking.locationType === 'GURDWARA'
              ? usedHeadOUT[h]
              : usedHeadGW[h];
          const usedHereHead =
            booking.locationType === 'GURDWARA'
              ? usedHeadGW[h]
              : usedHeadOUT[h];

          const remainingHead = Math.max(
            0,
            totalUniqueStaff - usedOppHead - usedHereHead
          );

          if (remainingHead < headcountRequired)
            throw new Error('CAPACITY_EXCEEDED');
        }
      }

      const updatedRaw = await tx.booking.update({
        where: { id: booking.id },
        data: {
          start,
          end,
          hallId,
        },
        include: {
          hall: { select: { name: true } },
        },
      });

      return {
        id: updatedRaw.id,
        title: updatedRaw.title,
        start: updatedRaw.start,
        end: updatedRaw.end,
        locationType: updatedRaw.locationType as
          | 'GURDWARA'
          | 'OUTSIDE_GURDWARA',
        hallId: updatedRaw.hallId,
        attendees: updatedRaw.attendees,
        hall: updatedRaw.hall ? { name: updatedRaw.hall.name } : null,
      };
    });

    return NextResponse.json(updated, { status: 200 });
  } catch (e: any) {
    if (String(e?.message) === 'CAPACITY_EXCEEDED') {
      return NextResponse.json(
        {
          error:
            'Not enough sevadars available for the new time (role minimums or total headcount).',
        },
        { status: 409 }
      );
    }
    console.error('Booking update error', e);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
