// src/app/api/availability/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { LocationType } from '@prisma/client';
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

// 15 min buffer (outside gurdwara only)
const OUTSIDE_BUFFER_MS = 15 * 60 * 1000;

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

    // Load selected programs for staffing + duration
    const programs = await prisma.programType.findMany({
      where: { id: { in: programTypeIds } },
      select: {
        durationMinutes: true,
        minPathers: true,
        minKirtanis: true,
        canBeOutsideGurdwara: true,
        requiresHall: true,
        peopleRequired: true,
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

    // Duration = longest program (run concurrently in one booking)
    const durationMinutes = Math.max(
      ...programs.map((p) => p.durationMinutes || 0)
    );
    const durationHours = Math.max(1, Math.ceil(durationMinutes / 60));

    // Candidate start hours
    const dayLocal = new Date(`${dateStr}T00:00:00`);
    let candidates = allowedStartHoursFor(dayLocal, durationHours);

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
        status: { in: ['PENDING', 'CONFIRMED'] }, // only active holds affect availability
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

          if (remaining < (required[r] ?? 0)) {
            ok = false;
          }
        }
        if (!ok) break;

        // Headcount guard (unique humans across roles)
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

      // Staff feasibility (from earlier calc)
      const req = required;
      const rem = remainingByHour[hStart] ?? { PATH: 0, KIRTAN: 0 };
      const hasStaff = rem.PATH >= req.PATH && rem.KIRTAN >= req.KIRTAN;

      // Hall feasibility
      let hasHall = true;
      let hallPick: string | null = null;

      if (needsHall) {
        if (hallId) {
          // honor the requested hall if provided
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
