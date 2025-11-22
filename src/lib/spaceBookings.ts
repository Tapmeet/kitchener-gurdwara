// src/lib/spaceBookings.ts
import { prisma } from '@/lib/db';
import { SpaceRecurrence, LocationType } from '@/generated/prisma/client';;
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';

export type SpaceBookingEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  classNames?: string[];
  extendedProps: {
    kind: 'space';
    spaceBookingId: string;
    locationType: LocationType;
    hallName: string | null;
    hallId: string | null;
    blocksHall: boolean;
    isPublicTitle: boolean;
    description: string | null;
    recurrence: SpaceRecurrence;
    interval: number;
    until: string | null;
  };
};

type SpaceBookingTemplate = {
  id: string;
  title: string;
  description: string | null;
  locationType: LocationType;
  hallId: string | null;
  hall: { id: string; name: string } | null;
  blocksHall: boolean;
  isPublicTitle: boolean;
  start: Date;
  end: Date;
  recurrence: SpaceRecurrence;
  interval: number;
  until: Date | null;
};

function nextOccurrence(
  start: Date,
  end: Date,
  recurrence: SpaceRecurrence,
  interval: number
): { start: Date; end: Date } {
  const step = Math.max(interval || 1, 1);

  switch (recurrence) {
    case 'DAILY':
      return {
        start: addDays(start, step),
        end: addDays(end, step),
      };
    case 'WEEKLY':
      return {
        start: addWeeks(start, step),
        end: addWeeks(end, step),
      };
    case 'MONTHLY':
      return {
        start: addMonths(start, step),
        end: addMonths(end, step),
      };
    case 'YEARLY':
      return {
        start: addYears(start, step),
        end: addYears(end, step),
      };
    default:
      // ONCE
      return { start, end };
  }
}

function buildEvent(
  tpl: SpaceBookingTemplate,
  occStart: Date,
  occEnd: Date
): SpaceBookingEvent {
  return {
    id: `space-${tpl.id}-${occStart.toISOString()}`,
    title: tpl.title,
    start: occStart,
    end: occEnd,
    classNames: ['event-blue', 'space-booking'],
    extendedProps: {
      kind: 'space',
      spaceBookingId: tpl.id,
      locationType: tpl.locationType,
      hallName: tpl.hall?.name ?? null,
      hallId: tpl.hall?.id ?? null,
      blocksHall: tpl.blocksHall,
      isPublicTitle: tpl.isPublicTitle,
      description: tpl.description,
      recurrence: tpl.recurrence,
      interval: tpl.interval,
      until: tpl.until ? tpl.until.toISOString() : null,
    },
  };
}

/**
 * Expand active SpaceBooking rows into concrete events in [from,to).
 */
export async function listSpaceBookingOccurrences(
  from: Date,
  to: Date
): Promise<SpaceBookingEvent[]> {
  const templates = await prisma.spaceBooking.findMany({
    where: {
      isActive: true,
      start: { lt: to },
      OR: [{ until: null }, { until: { gt: from } }],
    },
    orderBy: [{ start: 'asc' }, { title: 'asc' }],
    include: {
      hall: true,
    },
  });

  const events: SpaceBookingEvent[] = [];

  for (const tpl of templates as SpaceBookingTemplate[]) {
    const { recurrence, start, end, interval, until } = tpl;

    const untilLimit = until && until < to ? until : to;

    if (recurrence === 'ONCE') {
      if (end > from && start < to) {
        events.push(buildEvent(tpl, start, end));
      }
      continue;
    }

    let curStart = start;
    let curEnd = end;

    // Fast-forward until the first relevant occurrence
    let safety = 0;
    while (curEnd < from && (!untilLimit || curStart <= untilLimit)) {
      const next = nextOccurrence(curStart, curEnd, recurrence, interval);
      curStart = next.start;
      curEnd = next.end;
      safety++;
      if (safety > 2000) break; // sanity guard
    }

    // Generate all overlapping occurrences
    while (curStart < to && (!untilLimit || curStart <= untilLimit)) {
      if (curEnd > from) {
        events.push(buildEvent(tpl, curStart, curEnd));
      }
      const next = nextOccurrence(curStart, curEnd, recurrence, interval);
      curStart = next.start;
      curEnd = next.end;
      safety++;
      if (safety > 4000) break;
    }
  }

  return events;
}

/**
 * Lightweight overlap check used by hall picking to treat space bookings
 * as hall-blocking when blocksHall = true.
 */
export function spaceBookingOverlaps(
  template: {
    start: Date;
    end: Date;
    recurrence: SpaceRecurrence;
    interval: number;
    until: Date | null;
  },
  windowStart: Date,
  windowEnd: Date
): boolean {
  const { recurrence, start, end, interval, until } = template;
  const untilLimit = until ?? null;

  if (recurrence === 'ONCE') {
    return end > windowStart && start < windowEnd;
  }

  let curStart = start;
  let curEnd = end;

  let safety = 0;

  // Move forward until curEnd >= windowStart
  while (curEnd < windowStart) {
    const next = nextOccurrence(curStart, curEnd, recurrence, interval);
    curStart = next.start;
    curEnd = next.end;
    safety++;
    if (untilLimit && curStart > untilLimit) return false;
    if (safety > 2000) return false;
  }

  if (untilLimit && curStart > untilLimit) return false;

  // Now check overlap with [windowStart, windowEnd)
  return curStart < windowEnd && curEnd > windowStart;
}
