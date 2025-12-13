// src/lib/halls.ts
import { prisma } from '@/lib/db';
import { SpaceRecurrence } from '@/generated/prisma/client';
import { spaceBookingOverlaps } from '@/lib/spaceBookings';

export type TimeWindow = { start: Date; end: Date };

const HOUR_MS = 60 * 60 * 1000;

function overlaps(a: TimeWindow, b: TimeWindow) {
  return a.start < b.end && a.end > b.start;
}

function mergeWindows(windows: TimeWindow[]): TimeWindow[] {
  const w = windows
    .filter((x) => x?.start && x?.end && x.end > x.start)
    .map((x) => ({ start: new Date(x.start), end: new Date(x.end) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (!w.length) return [];
  const out: TimeWindow[] = [{ ...w[0] }];

  for (let i = 1; i < w.length; i++) {
    const cur = w[i];
    const last = out[out.length - 1];

    // merge overlaps OR touching windows
    if (cur.start.getTime() <= last.end.getTime()) {
      if (cur.end.getTime() > last.end.getTime()) last.end = cur.end;
    } else {
      out.push({ ...cur });
    }
  }

  return out;
}

function overlapsAny(a: TimeWindow[], b: TimeWindow[]) {
  for (const aw of a) for (const bw of b) if (overlaps(aw, bw)) return true;
  return false;
}

function isSehajName(name: string | null | undefined) {
  const n = (name ?? '').toLowerCase();
  return n.startsWith('sehaj path');
}

function hasKirtanInSehaj(
  items: Array<{ programType?: { name?: string | null } }>
) {
  return items.some((it) =>
    (it.programType?.name ?? '').toLowerCase().includes('kirtan')
  );
}

/**
 * Sehaj hall windows:
 * - Always: first 60 minutes
 * - Sehaj Path: last 60 minutes
 * - Sehaj Path + Kirtan: last 120 minutes (merged)
 */
function hallWindowsForSehaj(
  start: Date,
  end: Date,
  withKirtan: boolean
): TimeWindow[] {
  const s = new Date(start);
  const e = new Date(end);
  if (e <= s) return [];

  // First hour always blocked
  const firstEnd = new Date(Math.min(s.getTime() + HOUR_MS, e.getTime()));
  const windows: TimeWindow[] = [{ start: s, end: firstEnd }];

  const durMs = e.getTime() - s.getTime();
  if (durMs <= HOUR_MS) return mergeWindows(windows);

  // End window: 1h (Sehaj) or 2h (Sehaj + Kirtan)
  const endMinutes = withKirtan ? 2 * HOUR_MS : HOUR_MS;
  const endStart = new Date(Math.max(s.getTime(), e.getTime() - endMinutes));
  if (endStart < e) windows.push({ start: endStart, end: e });

  return mergeWindows(windows);
}

function hallWindowsForBooking(booking: {
  start: Date;
  end: Date;
  items?: Array<{ programType?: { name?: string | null } }>;
}): TimeWindow[] {
  const items = booking.items ?? [];
  const hasSehaj = items.some((it) =>
    isSehajName(it.programType?.name ?? null)
  );
  if (!hasSehaj) return [{ start: booking.start, end: booking.end }];

  // If a booking mixes Sehaj with any other program type, be conservative and block the full window.
  const mixed = items.some((it) => !isSehajName(it.programType?.name ?? null));
  if (mixed) return [{ start: booking.start, end: booking.end }];

  const withKirtan = hasKirtanInSehaj(items);
  return hallWindowsForSehaj(booking.start, booking.end, withKirtan);
}

export async function isHallFreeForWindows(
  hallId: string,
  windows: TimeWindow[],
  opts?: { ignoreBookingId?: string }
): Promise<boolean> {
  const want = mergeWindows(windows);
  if (!want.length) return true;

  const searchStart = want.reduce(
    (min, w) => (w.start.getTime() < min.getTime() ? w.start : min),
    want[0].start
  );
  const searchEnd = want.reduce(
    (max, w) => (w.end.getTime() > max.getTime() ? w.end : max),
    want[0].end
  );

  const overlappingBookings = await prisma.booking.findMany({
    where: {
      ...(opts?.ignoreBookingId ? { id: { not: opts.ignoreBookingId } } : {}),
      locationType: 'GURDWARA',
      hallId,
      start: { lt: searchEnd },
      end: { gt: searchStart },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    select: {
      id: true,
      hallId: true,
      start: true,
      end: true,
      items: {
        select: {
          programType: { select: { name: true } },
        },
      },
    },
  });

  for (const b of overlappingBookings) {
    const bWindows = hallWindowsForBooking({
      start: b.start,
      end: b.end,
      items: b.items,
    });
    if (overlapsAny(bWindows, want)) return false;
  }

  const spaceTemplates = await prisma.spaceBooking.findMany({
    where: {
      isActive: true,
      blocksHall: true,
      locationType: 'GURDWARA',
      hallId,
      start: { lt: searchEnd },
      OR: [{ until: null }, { until: { gt: searchStart } }],
    },
    select: {
      start: true,
      end: true,
      recurrence: true,
      interval: true,
      until: true,
    },
  });

  for (const sb of spaceTemplates) {
    for (const w of want) {
      if (
        spaceBookingOverlaps(
          {
            start: sb.start,
            end: sb.end,
            recurrence: sb.recurrence as SpaceRecurrence,
            interval: sb.interval,
            until: sb.until,
          },
          w.start,
          w.end
        )
      ) {
        return false;
      }
    }
  }

  return true;
}

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

/** Pick first free hall that fits attendees and is free in windows (or [start,end)). */
export async function pickFirstFittingHall(
  start: Date,
  end: Date,
  attendees: number,
  windows?: TimeWindow[]
): Promise<string | null> {
  const want = mergeWindows(windows ?? [{ start, end }]);
  if (!want.length) return null;

  const searchStart = want.reduce(
    (min, w) => (w.start.getTime() < min.getTime() ? w.start : min),
    want[0].start
  );
  const searchEnd = want.reduce(
    (max, w) => (w.end.getTime() > max.getTime() ? w.end : max),
    want[0].end
  );

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
      start: { lt: searchEnd },
      end: { gt: searchStart },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
    select: {
      hallId: true,
      start: true,
      end: true,
      items: {
        select: {
          programType: { select: { name: true } },
        },
      },
    },
  });

  const spaceTemplates = await prisma.spaceBooking.findMany({
    where: {
      isActive: true,
      blocksHall: true,
      locationType: 'GURDWARA',
      hallId: { not: null },
      start: { lt: searchEnd },
      OR: [{ until: null }, { until: { gt: searchStart } }],
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
    if (!b.hallId) continue;
    const bWindows = hallWindowsForBooking({
      start: b.start,
      end: b.end,
      items: b.items,
    });
    if (overlapsAny(bWindows, want)) busy.add(b.hallId);
  }

  // Recurring space bookings that block a hall
  for (const sb of spaceTemplates) {
    if (!sb.hallId) continue;
    for (const w of want) {
      if (
        spaceBookingOverlaps(
          {
            start: sb.start,
            end: sb.end,
            recurrence: sb.recurrence as SpaceRecurrence,
            interval: sb.interval,
            until: sb.until,
          },
          w.start,
          w.end
        )
      ) {
        busy.add(sb.hallId);
        break;
      }
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
