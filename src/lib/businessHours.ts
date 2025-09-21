export const BUSINESS_HOURS: Record<number, { openMinutes: number; closeMinutes: number }> = {
  0: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  1: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  2: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  3: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  4: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  5: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
  6: { openMinutes: 7 * 60, closeMinutes: 19 * 60 },
};

export const BUSINESS_HOURS_24 = Array.from({ length: 13 }, (_, i) => i + 7); // 7..19

function toLocalMinutes(d: Date) { return d.getHours() * 60 + d.getMinutes(); }

export function isWithinBusinessHours(start: Date, end: Date) {
  const dow = start.getDay();
  const cfg = BUSINESS_HOURS[dow];
  if (!cfg) return { ok: false as const, error: 'Business hours not configured.' };

  const s = toLocalMinutes(start);
  const e = toLocalMinutes(end);
  if (e <= s) return { ok: false as const, error: 'End time must be after start time.' };
  if (s < cfg.openMinutes) return { ok: false as const, error: 'Start is before opening time for that day.' };
  if (e > cfg.closeMinutes) return { ok: false as const, error: 'Booking extends past closing time for that day.' };
  return { ok: true as const };
}

export function allowedStartHoursFor(dateLocal: Date, durationHours: number): number[] {
  const { openMinutes, closeMinutes } = BUSINESS_HOURS[dateLocal.getDay()];
  const firstHour = Math.ceil(openMinutes / 60);
  const lastHourInclusive = Math.floor((closeMinutes - durationHours * 60) / 60);
  const out: number[] = [];
  for (let h = firstHour; h <= lastHourInclusive; h++) out.push(h);
  return out;
}

export function hourSpan(start: Date, end: Date): number[] {
  const out = new Set<number>();
  const s = new Date(start);
  const e = new Date(end);
  s.setSeconds(0, 0);
  e.setSeconds(0, 0);
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), 0, 0, 0);
  while (cur < e) {
    out.add(cur.getHours());
    cur.setHours(cur.getHours() + 1);
  }
  return Array.from(out.values());
}

export function minSelectableHour24(dateLocal: Date, now: Date): number {
  const base = 7;
  const sameDay = dateLocal.toDateString() === now.toDateString();
  if (!sameDay) return base;
  const h = now.getHours();
  const m = now.getMinutes();
  const nextHour = h + (m > 0 ? 1 : 0);
  return Math.max(base, nextHour);
}
