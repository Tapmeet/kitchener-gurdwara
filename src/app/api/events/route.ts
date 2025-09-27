import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Overlap rule: (start < to) AND (end > from)
export async function GET(req: Request) {
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
    include: { items: { include: { programType: true } } },
    orderBy: { start: 'asc' },
  });

  const events = bookings.map((b) => ({
    id: b.id,
    title: b.title,
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    extendedProps: {
      locationType: b.locationType,
      hallId: b.hallId,
      programs: b.items.map((i) => i.programType?.name).filter(Boolean),
    },
  }));

  return NextResponse.json(events);
}
