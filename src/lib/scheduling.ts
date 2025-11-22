import { LocationType } from '@/generated/prisma/client';;

export const SMALL_HALL_CAP = 125; // <= this => Small Hall / Hall 2
export const MAIN_HALL_CAP = 325; // > 125 => Main Hall
export const UPPER_HALL_CAP = 100; // Upper Hall cap (new)
export const OUTSIDE_BUFFER_MINUTES = 15;

const HALL_PATTERNS = {
  small: /(^|\b)(small\s*hall|hall\s*2)(\b|$)/i,
  main: /(^|\b)(main\s*hall|hall\s*1)(\b|$)/i,
  upper: /(^|\b)(upper\s*hall)(\b|$)/i,
};

export function bufferedWindow(
  startISO: string | Date,
  endISO: string | Date,
  location: LocationType
): { start: Date; end: Date } {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (location === 'OUTSIDE_GURDWARA') {
    return {
      start: new Date(start.getTime() - OUTSIDE_BUFFER_MINUTES * 60 * 1000),
      end: new Date(end.getTime() + OUTSIDE_BUFFER_MINUTES * 60 * 1000),
    };
  }
  return { start, end };
}

export function overlaps(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date }
) {
  return a.start < b.end && b.start < a.end;
}

// Infer capacity if DB record doesn’t include it
function inferredCapacity(h: {
  name: string;
  capacity?: number | null;
}): number | null {
  if (typeof h.capacity === 'number' && h.capacity >= 0) return h.capacity;
  if (HALL_PATTERNS.small.test(h.name)) return SMALL_HALL_CAP;
  if (HALL_PATTERNS.main.test(h.name)) return MAIN_HALL_CAP;
  if (HALL_PATTERNS.upper.test(h.name)) return UPPER_HALL_CAP;
  return null; // unknown
}

/**
 * Choose a hall that can fit `attendees`, honoring priority: Small → Main → Upper.
 * If a hall isn’t present, it’s skipped. If capacity is unknown, it’s treated as “unknown”
 * (we’ll only pick it if no known-capacity hall fits).
 */
export function pickHallIdForAttendees(
  attendees: number,
  halls: Array<{ id: string; name: string; capacity?: number | null }>
): string | null {
  const small = halls.find((h) => HALL_PATTERNS.small.test(h.name));
  const main = halls.find((h) => HALL_PATTERNS.main.test(h.name));
  const upper = halls.find((h) => HALL_PATTERNS.upper.test(h.name));

  const ordered = [small, main, upper].filter(Boolean) as typeof halls;

  // 1) Prefer the first hall in priority order that has a known capacity and fits
  for (const h of ordered) {
    const cap = inferredCapacity(h);
    if (cap !== null && attendees <= cap) return h.id;
  }

  // 2) If none with known capacity fit, fall back to the first with unknown capacity
  const unknown = ordered.find((h) => inferredCapacity(h) === null);
  if (unknown) return unknown.id;

  // 3) Otherwise no hall can fit; return null (caller can handle with a message)
  return null;
}
