// lib/businessHours.ts

// Single business window for all days: 7:00–19:00 (latest *end* time = 19:00).
// 0=Sun..6=Sat (JS Date.getDay()).
export const BUSINESS_HOURS: Record<
  number,
  { openMinutes: number; closeMinutes: number }
> = {
  0: { openMinutes: 7 * 60, closeMinutes: 19 * 60 }, // Sunday 7:00–19:00
  1: { openMinutes: 7 * 60, closeMinutes: 19 * 60 }, // Monday
  2: { openMinutes: 7 * 60, closeMinutes: 19 * 60 }, // Tuesday
  3: { openMinutes: 7 * 60, closeMinutes: 19 * 60 }, // Wednesday
  4: { openMinutes: 7 * 60, closeMinutes: 19 * 60 }, // Thursday
  5: { openMinutes: 7 * 60, closeMinutes: 19 * 60 }, // Friday
  6: { openMinutes: 7 * 60, closeMinutes: 19 * 60 }, // Saturday
};

function toLocalMinutes(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Validate that [start, end) is fully within the business hours for that date (local).
 * NOTE: we assume start and end are the *same calendar day* in local time.
 */
export function isWithinBusinessHours(
  start: Date,
  end: Date
): { ok: true } | { ok: false; error: string } {
  const dow = start.getDay();
  const cfg = BUSINESS_HOURS[dow];
  if (!cfg) return { ok: false, error: 'Business hours not configured.' };

  const s = toLocalMinutes(start);
  const e = toLocalMinutes(end);

  if (e <= s) return { ok: false, error: 'End time must be after start time.' };
  if (s < cfg.openMinutes) {
    return { ok: false, error: 'Start is before opening time for that day.' };
  }
  if (e > cfg.closeMinutes) {
    return {
      ok: false,
      error: 'Booking extends past closing time for that day.',
    };
  }
  return { ok: true };
}

/**
 * Compute allowed start hours (ints 0–23) for a given date and duration (in hours),
 * ensuring the booking ends by the day's close time.
 * With our 7:00–19:00 window, this yields 7..(19 - durationHours).
 */
export function allowedStartHoursFor(
  dateLocal: Date,
  durationHours: number
): number[] {
  const { openMinutes, closeMinutes } = BUSINESS_HOURS[dateLocal.getDay()];
  const firstHour = Math.ceil(openMinutes / 60); // 7
  const lastHourInclusive = Math.floor(
    (closeMinutes - durationHours * 60) / 60
  ); // e.g., for 2h: last = 17 so end=19

  const out: number[] = [];
  for (let h = firstHour; h <= lastHourInclusive; h++) out.push(h);
  return out;
}

/**
 * Convenience: intersect allowed hours with server-available hours
 * (i.e., remove already-booked hours). If server list is empty/undefined,
 * we show the allowed business hours (fallback).
 */
export function visibleStartHours(
  dateLocal: Date,
  durationHours: number,
  serverAvailableHours?: number[] | null
): number[] {
  const base = allowedStartHoursFor(dateLocal, durationHours);
  return Array.isArray(serverAvailableHours) && serverAvailableHours.length
    ? base.filter((h) => serverAvailableHours.includes(h))
    : base;
}

/** Pretty label like "7:00 AM", "12:00 PM", "5:00 PM". */
export function formatHourLabel(h24: number): string {
  const ap = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:00 ${ap}`;
}
