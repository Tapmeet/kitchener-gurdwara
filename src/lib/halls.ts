import { prisma } from '@/lib/db';

export const HALL_PRIORITY = ['Small Hall', 'Main Hall', 'Upper Hall'];

const HALL_PATTERNS = {
  small: /(^|\b)(small\s*hall|hall\s*2)(\b|$)/i,
  main: /(^|\b)(main\s*hall|hall\s*1)(\b|$)/i,
  upper: /(^|\b)(upper\s*hall)(\b|$)/i,
};
const CAP_DEFAULTS = { small: 125, main: 325, upper: 100 };

function capacityOf(name: string, capacity: number | null | undefined): number {
  if (typeof capacity === 'number' && capacity != null) return capacity;
  if (HALL_PATTERNS.small.test(name)) return CAP_DEFAULTS.small;
  if (HALL_PATTERNS.main.test(name)) return CAP_DEFAULTS.main;
  if (HALL_PATTERNS.upper.test(name)) return CAP_DEFAULTS.upper;
  // Unknown hall name → treat as very large to not block selection
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Pick first free hall (Small → Main → Upper) that fits attendees and is not busy.
 * Only looks at GURDWARA bookings with status PENDING/CONFIRMED overlapping [start,end).
 */
export async function pickFirstFittingHall(
  start: Date,
  end: Date,
  attendees: number
): Promise<string | null> {
  const halls = await prisma.hall.findMany({
    where: { isActive: true },
    select: { id: true, name: true, capacity: true },
  });

  // Priority order: Small → Main → Upper → then any remaining, by capacity asc
  const small =
    halls.find((h) => HALL_PATTERNS.small.test(h.name)) ??
    halls.find((h) => (h.capacity ?? 0) > 100 && (h.capacity ?? 0) <= 125);
  const main =
    halls.find((h) => HALL_PATTERNS.main.test(h.name)) ??
    halls.find((h) => (h.capacity ?? 0) > 125);
  const upper =
    halls.find((h) => HALL_PATTERNS.upper.test(h.name)) ??
    halls.find((h) => (h.capacity ?? 0) > 0 && (h.capacity ?? 0) <= 100);

  const prioritized: { id: string; name: string; capacity: number | null }[] = [
    small,
    main,
    upper,
    ...halls.filter(
      (h) => ![small?.id, main?.id, upper?.id].filter(Boolean).includes(h.id)
    ),
  ].filter(Boolean) as any;

  // Busy halls in the window
  const overlapping = await prisma.booking.findMany({
    where: {
      locationType: 'GURDWARA',
      hallId: { not: null },
      start: { lt: end },
      end: { gt: start },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    select: { hallId: true },
  });
  const busy = new Set(overlapping.map((b) => b.hallId!));

  for (const hall of prioritized) {
    const cap = capacityOf(hall.name, hall.capacity);
    if (cap >= Math.max(1, attendees) && !busy.has(hall.id)) {
      return hall.id;
    }
  }
  return null;
}

/** Back-compat wrapper used in older code. Not capacity-aware. */
export async function pickFirstFreeHall(start: Date, end: Date) {
  return pickFirstFittingHall(start, end, 1);
}
