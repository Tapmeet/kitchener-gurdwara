import { LocationType } from '@prisma/client';

export const SMALL_HALL_CAP = 125; // <= this => Small Hall / Hall 2
export const MAIN_HALL_CAP  = 325; // > 125 => Main Hall
export const OUTSIDE_BUFFER_MINUTES = 15;

/** If OUTSIDE_GURDWARA, apply 15 min buffer before & after. */
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

/** Basic interval overlap check. */
export function overlaps(a: {start: Date; end: Date}, b: {start: Date; end: Date}) {
  return a.start < b.end && b.start < a.end;
}

/** Auto-choose hall by attendees; Small hall by default when <= 125. */
export function pickHallIdForAttendees(
  attendees: number,
  halls: Array<{ id: string; name: string }>
): string | null {
  const small = halls.find(h => /Hall\s*2|Small Hall/i.test(h.name));
  const main  = halls.find(h => /Main Hall/i.test(h.name));

  if (attendees <= SMALL_HALL_CAP) {
    return small?.id ?? main?.id ?? halls[0]?.id ?? null;
  } else {
    return main?.id ?? small?.id ?? halls[0]?.id ?? null;
  }
}