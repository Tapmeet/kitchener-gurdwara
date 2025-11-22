import { prisma } from '@/lib/db';
import { SpaceRecurrence } from '@prisma/client';
import { spaceBookingOverlaps } from '@/lib/spaceBookings';

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
  return Number.MAX_SAFE_INTEGER; // unknown: don't block
}

/** Pick first free hall that fits attendees and is free in [start,end). */
export async function pickFirstFittingHall(
  start: Date,
  end: Date,
  attendees: number
): Promise<string | null> {
  const halls = await prisma.hall.findMany({
    where: { isActive: true },
    select: { id: true, name: true, capacity: true },
  });

  const small =
    halls.find((h) => HALL_PATTERNS.small.test(h.name)) ??
    halls.find((h) => (h.capacity ?? 0) > 100 && (h.capacity ?? 0) <= 125);
  const main =
    halls.find((h) => HALL_PATTERNS.main.test(h.name)) ??
    halls.find((h) => (h.capacity ?? 0) > 125);
  const upper =
    halls.find((h) => HALL_PATTERNS.upper.test(h.name)) ??
    halls.find((h) => (h.capacity ?? 0) > 0 && (h.capacity ?? 0) <= 100);

  const prioritized = [
    small,
    main,
    upper,
    ...halls.filter((h) => ![small?.id, main?.id, upper?.id].includes(h.id)),
  ].filter(Boolean) as { id: string; name: string; capacity: number | null }[];

  const overlappingBookings = await prisma.booking.findMany({
    where: {
      locationType: 'GURDWARA',
      hallId: { not: null },
      start: { lt: end },
      end: { gt: start },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    select: { hallId: true },
  });

  const spaceTemplates = await prisma.spaceBooking.findMany({
    where: {
      isActive: true,
      blocksHall: true,
      locationType: 'GURDWARA',
      hallId: { not: null },
      start: { lt: end },
      OR: [{ until: null }, { until: { gt: start } }],
    },
    select: {
      hallId: true,
      start: true,
      end: true,
      recurrence: true,
      interval: true,
      until: true,
    },
  });

  const busy = new Set<string>();

  // Normal bookings
  for (const b of overlappingBookings) {
    if (b.hallId) busy.add(b.hallId);
  }

  // Recurring space bookings that block a hall
  for (const sb of spaceTemplates) {
    if (!sb.hallId) continue;
    if (
      spaceBookingOverlaps(
        {
          start: sb.start,
          end: sb.end,
          recurrence: sb.recurrence as SpaceRecurrence,
          interval: sb.interval,
          until: sb.until,
        },
        start,
        end
      )
    ) {
      busy.add(sb.hallId);
    }
  }

  const need = Math.max(1, attendees);
  for (const hall of prioritized) {
    const cap = capacityOf(hall.name, hall.capacity);
    if (cap >= need && !busy.has(hall.id)) return hall.id;
  }
  return null;
}

/** Back-compat wrapper if older code calls it. */
export function pickFirstFreeHall(start: Date, end: Date) {
  return pickFirstFittingHall(start, end, 1);
}
