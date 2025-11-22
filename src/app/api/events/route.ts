// src/app/api/events/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { listSpaceBookingOccurrences } from '@/lib/spaceBookings';

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
    },
  });

  const bookingEvents = bookings.map((b) => ({
    id: b.id,
    title: b.title,
    start: b.start,
    end: b.end,
    classNames: [
      'event-blue',
      'booking',
      b.status === 'CONFIRMED' ? 'booking-confirmed' : 'booking-pending',
    ],
    extendedProps: {
      kind: 'booking',
      bookingId: b.id,
      locationType: b.locationType,
      hallName: b.hall?.name ?? null,
      status: b.status,
    },
  }));

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
