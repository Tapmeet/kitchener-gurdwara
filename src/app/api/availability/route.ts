import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { LocationType } from '@prisma/client';

// 15 min buffer (outside gurdwara only)
const OUTSIDE_BUFFER_MS = 15 * 60 * 1000;

// helper: overlap if (a.start < b.end && a.end > b.start)
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const dateStr = searchParams.get('date') ?? '';
    const programTypeId = searchParams.get('programTypeId') ?? '';
    const locationType = (searchParams.get('locationType') ?? '') as
      | LocationType
      | '';
    const attendees = Math.max(1, Number(searchParams.get('attendees') ?? '1'));
    const hallId = searchParams.get('hallId'); // optional, only matters at Gurdwara

    if (!dateStr || !programTypeId || !locationType) {
      return NextResponse.json(
        { error: 'Missing date/programTypeId/locationType' },
        { status: 400 }
      );
    }

    // Load program for its duration
    const pt = await prisma.programType.findUnique({
      where: { id: programTypeId },
      select: { durationMinutes: true },
    });
    if (!pt) {
      return NextResponse.json(
        { error: 'Program type not found' },
        { status: 404 }
      );
    }

    // Start-of-day for the date (local server time)
    const d = new Date(`${dateStr}T00:00:00`);
    const hours: number[] = [];

    // Pull all bookings for that day (and same hall if provided)
    // We fetch a 36h window around the day to be safe, then filter.
    const dayStart = new Date(d);
    const dayEnd = new Date(d);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const where: any = {
      start: { lt: dayEnd },
      end: { gt: dayStart },
    };
    if (locationType === 'GURDWARA' && hallId) {
      where.hallId = hallId;
    }

    const dayBookings = await prisma.booking.findMany({
      where,
      select: { start: true, end: true, locationType: true, hallId: true },
    });

    // For each hour 0..23, see if it conflicts
    for (let h = 0; h < 24; h++) {
      const start = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        h,
        0,
        0,
        0
      );
      const end = new Date(start.getTime() + pt.durationMinutes * 60 * 1000);

      // Apply outside buffer
      const candStart =
        locationType === 'OUTSIDE_GURDWARA'
          ? new Date(start.getTime() - OUTSIDE_BUFFER_MS)
          : start;
      const candEnd =
        locationType === 'OUTSIDE_GURDWARA'
          ? new Date(end.getTime() + OUTSIDE_BUFFER_MS)
          : end;

      // conflict if overlaps any existing booking that matters for the same space
      const conflict = dayBookings.some((b) => {
        // If current is Gurdwara and hallId is specified, only compare with same hall.
        if (locationType === 'GURDWARA' && hallId) {
          if (b.hallId !== hallId) return false;
        }
        // Otherwise, any booking overlaps time-wise is a conflict.
        return overlaps(candStart, candEnd, b.start, b.end);
      });

      if (!conflict) hours.push(h);
    }

    return NextResponse.json({ hours });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unexpected error' },
      { status: 500 }
    );
  }
}
