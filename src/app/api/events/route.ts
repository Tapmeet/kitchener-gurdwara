import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const where: any = {};
  if (from) where.start = { gte: new Date(from) };
  if (to) where.end = { lte: new Date(to) };
  const bookings = await prisma.booking.findMany({
    where,
    include: { items: { include: { programType: true } } },
  });
  const events = bookings.map((b) => ({
    id: b.id,
    title: b.title,
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    extendedProps: {
      locationType: b.locationType,
      hallId: b.hallId,
      programs: b.items.map((i) => i.programType.name),
      address: b.address,
      addressCity: b.addressCity,
      addressProvince: b.addressProvince,
      addressPostal: b.addressPostal,
    },
  }));
  return NextResponse.json(events);
}
