export const KIRTAN_CAP = 2; // two ragi jathas
export const PATH_CAP = 1; // one granthi

export type ProgramLite = { id: string; category: string };
export type OverlapItem = { programType: ProgramLite };
export type OverlapBooking = { start: Date; end: Date; items: OverlapItem[] };

export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && aEnd > bStart;

export function tally(overlapsList: OverlapBooking[]) {
  let kirtans = 0,
    paths = 0;
  for (const b of overlapsList)
    for (const it of b.items) {
      if (it.programType.category === 'KIRTAN') kirtans++;
      if (it.programType.category === 'PATH') paths++;
    }
  return { kirtans, paths };
}

export function checkCaps(
  existing: OverlapBooking[],
  requested: ProgramLite[]
) {
  const { kirtans, paths } = tally(existing);
  const wantK = requested.filter((p) => p.category === 'KIRTAN').length;
  const wantP = requested.filter((p) => p.category === 'PATH').length;

  if (kirtans + wantK > KIRTAN_CAP)
    return {
      ok: false,
      error:
        'Conflict: max 2 Kirtans can run at the same time. Please adjust time or call Secretary/Granthi.',
    };

  if (paths + wantP > PATH_CAP)
    return {
      ok: false,
      error:
        'Conflict: max 1 Path can run at the same time. Please adjust time or call Secretary/Granthi.',
    };

  return { ok: true } as const;
}
