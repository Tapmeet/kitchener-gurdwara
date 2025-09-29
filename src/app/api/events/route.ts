import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';

// Overlap rule: (start < to) AND (end > from)
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  const isAdmin = role === 'ADMIN' || role === 'SECRETARY';

  const { searchParams } = new URL(req.url);
  const fromStr = searchParams.get('from');
  const toStr = searchParams.get('to');

  const where: any = {};
  if (fromStr || toStr) {
    where.AND = [
      toStr ? { start: { lt: new Date(toStr) } } : {},
      fromStr ? { end: { gt: new Date(fromStr) } } : {},
    ].filter(Boolean);
  }

  const bookings = await prisma.booking.findMany({
    where,
    include: {
      items: { include: { programType: true } },
    },
    orderBy: { start: 'asc' },
  });

  // Map to FullCalendar-style events
  const allEvents = bookings.map((b) => {
    const programs = b.items
      .map((i) => i.programType?.name)
      .filter((x): x is string => Boolean(x));

    return {
      id: b.id,
      title: b.title, // may be overridden below for public
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      extendedProps: {
        locationType: b.locationType,
        hallId: b.hallId,
        programs,
      },
    };
  });

  if (isAdmin) {
    // Admins get the full rich event objects
    return NextResponse.json(allEvents);
  }

  // Public: only show the "program name" as the title, no extendedProps
  const publicEvents = allEvents.map((e) => ({
    id: e.id,
    title: 'Booked',
    start: e.start,
    end: e.end,
    classNames: ['public-booked'],
  }));

  return NextResponse.json(publicEvents);
}
