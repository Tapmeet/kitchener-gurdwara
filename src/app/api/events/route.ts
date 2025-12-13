// src/app/api/events/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { listSpaceBookingOccurrences } from '@/lib/spaceBookings';

function addMinutes(d: Date, mins: number) {
  return new Date(d.getTime() + mins * 60_000);
}
function subMinutes(d: Date, mins: number) {
  return new Date(d.getTime() - mins * 60_000);
}
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}
function isSehaj(programNames: string[]) {
  // matches: "Sehaj", "Sehaj Path", "Sehaj Path + Kirtan", etc.
  return programNames.some((n) => /^sehaj\b/i.test(n));
}
function isSehajPlusKirtan(programNames: string[]) {
  return programNames.some((n) => /sehaj.*kirtan/i.test(n));
}

/**
 * Calendar DISPLAY windows (merged):
 * - Start window: first 60 minutes
 * - End window: last 60 minutes (Sehaj) OR last 120 minutes (Sehaj + Kirtan)
 * If they overlap (very short booking), show one full block.
 */
function buildSehajDisplayWindowsMerged(
  start: Date,
  end: Date,
  plusKirtan: boolean
) {
  const startEnd = addMinutes(start, 60);
  const startWindow = {
    start,
    end: startEnd < end ? startEnd : end,
    slot: 'start' as const,
  };

  const endMinutes = plusKirtan ? 120 : 60;
  const endStart = subMinutes(end, endMinutes);
  const safeEndStart = endStart > start ? endStart : start;

  const endWindow = { start: safeEndStart, end, slot: 'end' as const };

  if (
    overlaps(startWindow.start, startWindow.end, endWindow.start, endWindow.end)
  ) {
    return [{ start, end, slot: 'full' as const }];
  }

  return [startWindow, endWindow];
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  const isAdmin = role === 'ADMIN';

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get('from');
  const toStr = searchParams.get('to');

  const now = new Date();

  const from = fromStr
    ? new Date(fromStr)
    : new Date(now.getTime() - 30 * 86400000);
  const to = toStr ? new Date(toStr) : new Date(now.getTime() + 30 * 86400000);

  // 1) Normal bookings (pending + confirmed)
  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ['PENDING', 'CONFIRMED'] },
      start: { lt: to },
      end: { gt: from },
    },
    select: {
      id: true,
      title: true,
      start: true,
      end: true,
      locationType: true,
      hall: { select: { id: true, name: true } },
      status: true,
      items: {
        select: {
          programType: { select: { name: true } },
        },
      },
    },
  });

  // NOTE: use flatMap because Sehaj becomes multiple calendar events
  const bookingEvents = bookings.flatMap((b) => {
    const programNames = (b.items ?? [])
      .map((i) => i.programType?.name)
      .filter(Boolean) as string[];

    const plusKirtan = isSehajPlusKirtan(programNames);

    const base = {
      title: b.title,
      classNames: [
        'event-blue',
        'booking',
        b.status === 'CONFIRMED' ? 'booking-confirmed' : 'booking-pending',
      ],
      extendedProps: {
        kind: 'booking',
        bookingId: b.id, // ✅ important for click-details
        locationType: b.locationType,
        hallName: b.hall?.name ?? null,
        status: b.status,
        programNames, // ✅ used for chips/details
      },
    };

    // Sehaj DISPLAY logic (merged end)
    if (isSehaj(programNames)) {
      const windows = buildSehajDisplayWindowsMerged(b.start, b.end, plusKirtan)
        .filter((w) => w.start < w.end)
        .filter((w) => overlaps(w.start, w.end, from, to));

      return windows.map((w, idx) => ({
        id: `${b.id}:sehaj:${w.slot}:${idx}`,
        ...base,
        title:
          w.slot === 'start'
            ? `${b.title} (Start)`
            : w.slot === 'end'
              ? `${b.title} (End)`
              : b.title,
        start: w.start,
        end: w.end,
        extendedProps: {
          ...base.extendedProps,
          sehajSlot: w.slot,
        },
      }));
    }

    // Normal booking: unchanged
    return [
      {
        id: b.id,
        ...base,
        start: b.start,
        end: b.end,
      },
    ];
  });

  // 2) Recurring/admin “space bookings”
  const spaceEvents = await listSpaceBookingOccurrences(from, to);

  const adminEvents = [...bookingEvents, ...spaceEvents];

  if (isAdmin) {
    return NextResponse.json(adminEvents);
  }

  // Public view:
  // - Normal bookings: generic "Booked"
  // - Space bookings with isPublicTitle=true: show real title
  const publicEvents = adminEvents.map((e: any) => {
    if (e.extendedProps?.kind === 'space') {
      if (e.extendedProps.isPublicTitle) {
        return {
          ...e,
          classNames: [...(e.classNames ?? []), 'public-space-booking'],
        };
      }
      // masked space booking (rare case)
      return {
        id: e.id,
        title: 'Booked',
        start: e.start,
        end: e.end,
        classNames: [...(e.classNames ?? []), 'public-booked'],
      };
    }

    // Normal booking: always generic for public
    return {
      id: e.id,
      title: 'Booked',
      start: e.start,
      end: e.end,
      classNames: [...(e.classNames ?? []), 'public-booked'],
    };
  });

  return NextResponse.json(publicEvents);
}
