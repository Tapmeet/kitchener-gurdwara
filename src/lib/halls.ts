import { prisma } from '@/lib/db';

const HALL_PRIORITY = ['Small Hall', 'Main Hall', 'Upper Hall'];

export async function pickFirstFreeHall(start: Date, end: Date) {
  const halls = await prisma.hall.findMany({
    where: { name: { in: HALL_PRIORITY } },
    orderBy: { name: 'asc' }, // Small, Main, Upper
  });

  // Fetch overlapping bookings to avoid N queries
  const overlapping = await prisma.booking.findMany({
    where: {
      hallId: { not: null },
      start: { lt: end },
      end: { gt: start },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    select: { hallId: true },
  });
  const busy = new Set(overlapping.map((b) => b.hallId!));

  for (const hall of halls) {
    if (!busy.has(hall.id)) return hall.id;
  }
  return null;
}
