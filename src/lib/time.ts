// src/lib/time.ts
import { formatInTimeZone } from 'date-fns-tz';
import { VENUE_TZ } from './businessHours';

export const TZ = VENUE_TZ;
export const DATE_TIME_FMT = 'EEE, MMM d yyyy, h:mm a';
export const DATE_FMT = 'MMM d, yyyy';
export const MONTH_FMT = 'MMMM yyyy';

/** Format any date-like value in the venue timezone. */
export function fmtInVenue(
  d: Date | string | number,
  pattern: string = DATE_TIME_FMT
) {
  const date = d instanceof Date ? d : new Date(d);
  return formatInTimeZone(date, TZ, pattern);
}

/** Convenience range formatter (e.g., Oct 13, 2025 – Jan 18, 2026). */
export function fmtRange(
  start: Date | string | number,
  end: Date | string | number,
  pattern: string = DATE_FMT
) {
  return `${fmtInVenue(start, pattern)} – ${fmtInVenue(end, pattern)}`;
}
