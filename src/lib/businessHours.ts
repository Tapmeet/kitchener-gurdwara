// Opening hours (local time). We keep minutes to represent the 6:30 open.
// close is the latest *end* time allowed (e.g. 22:00 = 10 PM).
// 0=Sun, 1=Mon, ... 6=Sat (JS Date.getDay())
export const BUSINESS_HOURS: Record<
  number,
  { openMinutes: number; closeMinutes: number }
> = {
  0: { openMinutes: 6 * 60 + 30, closeMinutes: 22 * 60 }, // Sunday 6:30–22:00
  1: { openMinutes: 6 * 60 + 30, closeMinutes: 20 * 60 }, // Monday 6:30–20:00
  2: { openMinutes: 6 * 60 + 30, closeMinutes: 20 * 60 }, // Tuesday
  3: { openMinutes: 6 * 60 + 30, closeMinutes: 20 * 60 }, // Wednesday
  4: { openMinutes: 6 * 60 + 30, closeMinutes: 20 * 60 }, // Thursday
  5: { openMinutes: 6 * 60 + 30, closeMinutes: 20 * 60 }, // Friday
  6: { openMinutes: 6 * 60 + 30, closeMinutes: 22 * 60 }, // Saturday 6:30–22:00
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
 * For hour-only UI: compute allowed hour starts (integers 0–23) given date and durationHours.
 * We round opening 6:30 up to the next full hour (7:00).
 */
export function allowedStartHoursFor(
  dateLocal: Date,
  durationHours: number
): number[] {
  const { openMinutes, closeMinutes } = BUSINESS_HOURS[dateLocal.getDay()];
  const firstHour = Math.ceil(openMinutes / 60); // 6:30 -> 7
  const lastHourInclusive = Math.floor(
    (closeMinutes - durationHours * 60) / 60
  ); // ensure end <= close

  const out: number[] = [];
  for (let h = firstHour; h <= lastHourInclusive; h++) {
    out.push(h);
  }
  return out;
}
