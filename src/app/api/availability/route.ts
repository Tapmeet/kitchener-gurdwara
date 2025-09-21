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

    // NEW: accept multi-select, fall back to single
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
      },
    });
    if (!programs.length) {
      return NextResponse.json(
        { error: 'Program types not found' },
        { status: 404 }
      );
    }

    // Basic location rules
    if (
      locationType === 'OUTSIDE_GURDWARA' &&
      programs.some((p) => !p.canBeOutsideGurdwara)
    ) {
      return NextResponse.json({
        hours: [],
        remainingByHour: {},
        required: {},
        error: 'One or more programs cannot be performed outside.',
      });
    }
    if (
      locationType === 'GURDWARA' &&
      programs.some((p) => p.requiresHall) &&
      !hallId
    ) {
      return NextResponse.json({
        hours: [],
        remainingByHour: {},
        required: {},
        error: 'Hall is required for selected programs.',
      });
    }

    // Required roles vector (sum of all selected programs)
    const required: RoleVector = programs.reduce(
      (acc, p) => add(acc, reqFromProgram(p)),
      { PATH: 0, KIRTAN: 0 }
    );

    // Duration = longest program (they run concurrently in the same booking)
    const durationMinutes = Math.max(
      ...programs.map((p) => p.durationMinutes || 0)
    );
    const durationHours = Math.max(1, Math.ceil(durationMinutes / 60)); // round up to whole hours

    // Build candidate start hours within business window for that date (7..19-duration)
    const dayLocal = new Date(`${dateStr}T00:00:00`);
    let candidates = allowedStartHoursFor(dayLocal, durationHours);

    // (Optional but recommended) Also hide past times for today on the API
    const minHourToday = minSelectableHour24(dayLocal, new Date());
    candidates = candidates.filter((h) => h >= minHourToday);

    // Fetch ALL overlaps that touch the day (both locations → shared pool math)
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999`);
    const overlaps = await prisma.booking.findMany({
      where: {
        start: { lte: dayEnd },
        end: { gte: dayStart },
        // NOTE: we DO NOT filter by hall here for staffing, since sevadars are a shared pool.
      },
      include: {
        items: {
          include: {
            programType: { select: { minPathers: true, minKirtanis: true } },
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

    for (const b of overlaps) {
      // Sum role demand for this booking
      const vec = b.items.reduce(
        (acc, it) => add(acc, reqFromProgram(it.programType as any)),
        { PATH: 0, KIRTAN: 0 }
      );

      // Apply buffer around OUTSIDE bookings when calculating which hours they occupy
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
        } else {
          usedOUT[h].PATH += vec.PATH ?? 0;
          usedOUT[h].KIRTAN += vec.KIRTAN ?? 0;
        }
      }
    }

    // Total pool from active staff; per-location max (logistics cap)
    const totalPool = await getTotalPoolPerRole(); // { PATH, KIRTAN }
    const locMax = getMaxPerLocationPerRole(locationType); // { PATH, KIRTAN }

    // Evaluate each candidate start hour across its entire span
    const hours: number[] = [];
    const remainingByHour: Record<number, RoleVector> = {};

    for (const hStart of candidates) {
      // Candidate span start/end for this booking
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

      // Apply buffer if requesting OUTSIDE
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

      // Compute min remaining across the span per role (conservative value to show in UI)
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
              ? usedOUT[hh][r] ?? 0
              : usedGW[hh][r] ?? 0;
          const usedHere =
            locationType === 'GURDWARA'
              ? usedGW[hh][r] ?? 0
              : usedOUT[hh][r] ?? 0;

          // Shared pool: what's left after the other location
          const sharedLimit = Math.max(0, total - usedOpp);
          // Logistics per-location cap
          const locLimit = Math.min(
            sharedLimit,
            locMax[r] ?? Number.MAX_SAFE_INTEGER
          );

          const remaining = Math.max(0, locLimit - usedHere);
          minRem[r] = Math.min(minRem[r] as number, remaining);

          if (remaining < (required[r] ?? 0)) {
            ok = false; // this start hour cannot satisfy the span
          }
        }
        if (!ok) break;
      }

      if (ok) {
        hours.push(hStart);
        // If minRem is still MAX_SAFE_INTEGER (zero-length span), normalize to 0s
        if (minRem.PATH === Number.MAX_SAFE_INTEGER) minRem.PATH = 0;
        if (minRem.KIRTAN === Number.MAX_SAFE_INTEGER) minRem.KIRTAN = 0;
        remainingByHour[hStart] = minRem;
      }
    }

    return NextResponse.json({ hours, remainingByHour, required });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unexpected error' },
      { status: 500 }
    );
  }
}
