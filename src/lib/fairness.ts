// src/lib/fairness.ts
import { prisma } from '@/lib/db';
import { startOfWeek, endOfWeek, subWeeks } from 'date-fns';
import type { ProgramCategory } from '@prisma/client';

export type Role = 'PATH' | 'KIRTAN';
export type Jatha = 'A' | 'B';

// Overlap helper for booking (windowless assignments)
function bookingOverlapWhere(start: Date, end: Date) {
  return { start: { lt: end }, end: { gt: start } };
}

/**
 * Return the set of staffIds that are busy in [start, end)
 * Busy if:
 *  - a windowed assignment overlaps the slot, OR
 *  - a windowless assignment exists and its BOOKING overlaps the slot.
 */
export async function busyStaffIds(start: Date, end: Date) {
  const rows = await prisma.bookingAssignment.findMany({
    where: {
      OR: [
        // windowed: assignment [start,end) overlaps
        { start: { lt: end }, end: { gt: start } },
        // windowless: rely on booking window
        {
          AND: [
            { start: null },
            { end: null },
            { booking: bookingOverlapWhere(start, end) },
          ],
        },
      ],
    },
    select: { staffId: true },
  });
  return new Set(rows.map((r) => r.staffId));
}

/** Jatha members qualified for Kirtan who are free in [start, end) */
export async function availableJathaMembers(
  jatha: Jatha,
  start: Date,
  end: Date
) {
  const busy = await busyStaffIds(start, end);
  const rows = await prisma.staff.findMany({
    where: { isActive: true, jatha, skills: { has: 'KIRTAN' } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return rows.filter((r) => !busy.has(r.id));
}

/** Path-only staff (no Kirtan) free in [start, end) */
export async function availablePathOnly(start: Date, end: Date) {
  const busy = await busyStaffIds(start, end);
  const rows = await prisma.staff.findMany({
    where: {
      isActive: true,
      skills: { has: 'PATH' },
      NOT: { skills: { has: 'KIRTAN' } },
    },
    select: { id: true, name: true },
  });
  return rows.filter((r) => !busy.has(r.id));
}

/**
 * Weighted load per staff over a rolling window.
 * Uses compWeight on programType; counts assignments in the last `windowWeeks`.
 * Works for windowed (assignment times) and windowless (booking times).
 */
export async function weightedLoadByStaff(
  staffIds: string[],
  windowWeeks = 8,
  roleFilter?: Role
) {
  if (!staffIds.length) return new Map<string, number>();

  const end = endOfWeek(new Date(), { weekStartsOn: 1 });
  const start = subWeeks(startOfWeek(end, { weekStartsOn: 1 }), windowWeeks);

  const rows = await prisma.bookingAssignment.findMany({
    where: {
      staffId: { in: staffIds },
      OR: [
        // windowed assignments
        { AND: [{ start: { gte: start } }, { end: { lte: end } }] },
        // windowless – fall back to booking times
        {
          AND: [
            { start: null },
            { end: null },
            { booking: { start: { gte: start }, end: { lte: end } } },
          ],
        },
      ],
      ...(roleFilter
        ? {
            bookingItem: {
              programType: { category: roleFilter as ProgramCategory },
            },
          }
        : {}),
    },
    select: {
      staffId: true,
      bookingItem: {
        select: { programType: { select: { compWeight: true } } },
      },
    },
  });

  const map = new Map<string, number>(staffIds.map((id) => [id, 0]));
  for (const r of rows) {
    const w = r.bookingItem.programType.compWeight ?? 1;
    map.set(r.staffId, (map.get(r.staffId) ?? 0) + w);
  }
  return map;
}

/**
 * Order ids by ascending weighted load (role-scoped) with a stable fallback.
 */
export async function orderByWeightedLoad(
  ids: string[],
  role: Role,
  windowWeeks = 8
) {
  const loads = await weightedLoadByStaff(ids, windowWeeks, role);
  return [...ids].sort((i, j) => {
    const a = loads.get(i) ?? 0;
    const b = loads.get(j) ?? 0;
    if (a !== b) return a - b;
    return i.localeCompare(j); // stable tie-break
  });
}

/**
 * Pick Jatha for a slot fairly:
 *  1) Prefer side that can field ≥3 free members.
 *  2) If both can, compare sum of the lightest 3 (weighted load).
 *  3) If still tied (or neither has 3), use deterministic alternating seed.
 *  4) If absolutely nobody free, return null.
 */
export async function pickJathaForSlot(
  start: Date,
  end: Date
): Promise<Jatha | null> {
  const aFree = (await availableJathaMembers('A', start, end)).map((m) => m.id);
  const bFree = (await availableJathaMembers('B', start, end)).map((m) => m.id);

  const aHasTeam = aFree.length >= 3;
  const bHasTeam = bFree.length >= 3;

  if (aHasTeam && !bHasTeam) return 'A';
  if (!aHasTeam && bHasTeam) return 'B';

  if (aHasTeam && bHasTeam) {
    // Compare the lowest-3 total loads on each side
    const [aOrdered, bOrdered] = await Promise.all([
      orderByWeightedLoad(aFree, 'KIRTAN'),
      orderByWeightedLoad(bFree, 'KIRTAN'),
    ]);
    const aLoads = await weightedLoadByStaff(aOrdered.slice(0, 3), 8, 'KIRTAN');
    const bLoads = await weightedLoadByStaff(bOrdered.slice(0, 3), 8, 'KIRTAN');
    const aSum = aOrdered
      .slice(0, 3)
      .reduce((s, id) => s + (aLoads.get(id) ?? 0), 0);
    const bSum = bOrdered
      .slice(0, 3)
      .reduce((s, id) => s + (bLoads.get(id) ?? 0), 0);

    if (aSum < bSum) return 'A';
    if (bSum < aSum) return 'B';
    // tie → deterministic alternation by day+hour
    const seed = `${start.toISOString().slice(0, 10)}-${start.getHours()}`;
    const sum = Array.from(seed).reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return sum % 2 === 0 ? 'A' : 'B';
  }

  // Neither side has 3 → pick the one with more free; tie by seed; if none free, null.
  if (aFree.length === 0 && bFree.length === 0) return null;
  if (aFree.length > bFree.length) return 'A';
  if (bFree.length > aFree.length) return 'B';

  const seed = `${start.toISOString().slice(0, 10)}-${start.getHours()}`;
  const sum = Array.from(seed).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return sum % 2 === 0 ? 'A' : 'B';
}
