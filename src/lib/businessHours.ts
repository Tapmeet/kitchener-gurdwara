// src/lib/businessHours.ts

export const VENUE_TZ = 'America/Toronto';

export const BUSINESS_HOURS: Record<
  number,
  { openMinutes: number; closeMinutes: number }
> = {
  0: { openMinutes: 7 * 60, closeMinutes: 19 * 60 }, // Sunday
  1: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  2: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  3: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  4: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  5: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  6: { openMinutes: 7 * 60, closeMinutes: 19 * 60 }, // Saturday
};

// 7..19 (inclusive) as 24h hours
export const BUSINESS_HOURS_24 = Array.from({ length: 13 }, (_, i) => i + 7);

/* -------------------- TZ utils -------------------- */

function tzFields(d: Date, tz: string = VENUE_TZ) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const weekday = get('weekday'); // "Sunday".."Saturday"
  const dow = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ].indexOf(weekday);
  const y = parseInt(get('year'), 10);
  const m = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  return { hour, minute, dow, y, m, day };
}

function minutesInTz(d: Date, tz: string = VENUE_TZ) {
  const { hour, minute } = tzFields(d, tz);
  return hour * 60 + minute;
}

/* ------------------- Core (TZ-aware) ------------------- */

// Overload so old callers with 2 args keep working
export function isWithinBusinessHours(
  startUTC: Date,
  endUTC: Date
): { ok: true } | { ok: false; error: string };
export function isWithinBusinessHours(
  startUTC: Date,
  endUTC: Date,
  tz: string
): { ok: true } | { ok: false; error: string };
export function isWithinBusinessHours(
  startUTC: Date,
  endUTC: Date,
  tz: string = VENUE_TZ
) {
  const sMin = minutesInTz(startUTC, tz);
  const eMin = minutesInTz(endUTC, tz);
  const { dow } = tzFields(startUTC, tz);

  const cfg = BUSINESS_HOURS[dow];
  if (!cfg)
    return { ok: false as const, error: 'Business hours not configured.' };
  if (eMin <= sMin)
    return { ok: false as const, error: 'End time must be after start time.' };
  if (sMin < cfg.openMinutes)
    return {
      ok: false as const,
      error: 'Start is before opening time for that day.',
    };
  if (eMin > cfg.closeMinutes)
    return {
      ok: false as const,
      error: 'Booking extends past closing time for that day.',
    };
  return { ok: true as const };
}

export function allowedStartHoursForTZ(
  dateUTC: Date,
  durationHours: number,
  tz: string = VENUE_TZ
): number[] {
  const { dow } = tzFields(dateUTC, tz);
  const { openMinutes, closeMinutes } = BUSINESS_HOURS[dow];
  const firstHour = Math.ceil(openMinutes / 60);
  const lastHourInclusive = Math.floor(
    (closeMinutes - durationHours * 60) / 60
  );
  const out: number[] = [];
  for (let h = firstHour; h <= lastHourInclusive; h++) out.push(h);
  return out;
}

export function hourSpanTZ(
  startUTC: Date,
  endUTC: Date,
  tz: string = VENUE_TZ
): number[] {
  const out = new Set<number>();
  // Anchor to the first top-of-hour (in venue TZ) at/after start
  let cur = new Date(startUTC);
  const rem = (60 - (minutesInTz(cur, tz) % 60)) % 60;
  if (rem) cur = new Date(cur.getTime() + rem * 60_000);

  while (cur < endUTC) {
    out.add(tzFields(cur, tz).hour);
    cur = new Date(cur.getTime() + 60 * 60 * 1000);
  }
  return Array.from(out.values());
}

export function minSelectableHour24TZ(
  dateUTC: Date,
  nowUTC: Date,
  tz: string = VENUE_TZ
): number {
  const base = 7;
  const dF = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const sameDay = dF.format(dateUTC) === dF.format(nowUTC);
  if (!sameDay) return base;

  const { hour, minute } = tzFields(nowUTC, tz);
  const nextHour = hour + (minute > 0 ? 1 : 0);
  return Math.max(base, nextHour);
}

/* --------------- Back-compat wrappers (old names) --------------- */
// These keep your existing imports working but now behave TZ-aware.

// Back-compat wrappers (old names)
export function allowedStartHoursFor(dateUTC: Date, durationHours: number): number[] {
  return allowedStartHoursForTZ(dateUTC, durationHours, VENUE_TZ);
}

export function hourSpan(startUTC: Date, endUTC: Date): number[] {
  return hourSpanTZ(startUTC, endUTC, VENUE_TZ);
}

export function minSelectableHour24(dateUTC: Date, nowUTC: Date): number {
  return minSelectableHour24TZ(dateUTC, nowUTC, VENUE_TZ);
}
