// src/app/api/events/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  const isAdmin = role === 'ADMIN';

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get('from');
  const toStr = searchParams.get('to');
  const from = fromStr ? new Date(fromStr) : undefined;
  const to = toStr ? new Date(toStr) : undefined;

  // Build Prisma where with overlap
  const where: any = {
    // Hide cancelled/expired for everyone
    status: isAdmin ? { in: ['PENDING', 'CONFIRMED'] } : 'CONFIRMED',
  };
  if (to) where.start = { lt: to }; // start < to
  if (from) where.end = { gt: from }; // end > from

  const bookings = await prisma.booking.findMany({
    where,
    include: {
      hall: true,
      items: { include: { programType: true } },
    },
    orderBy: { start: 'asc' },
  });

  // Map to events
  const adminEvents = bookings.map((b) => {
    const programs = b.items
      .map((i) => i.programType?.name)
      .filter((x): x is string => Boolean(x));

    return {
      id: b.id,
      title: b.title,
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      extendedProps: {
        locationType: b.locationType,
        hallId: b.hallId,
        programs,
        status: b.status,
      },
    };
  });

  if (isAdmin) return NextResponse.json(adminEvents);

  // Public view: generic title, no details
  const publicEvents = adminEvents.map((e) => ({
    id: e.id,
    title: 'Booked',
    start: e.start,
    end: e.end,
    classNames: ['public-booked'],
  }));

  return NextResponse.json(publicEvents);
}
