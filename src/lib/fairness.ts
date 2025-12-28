// src/lib/fairness.ts
import { prisma } from '@/lib/db';
import { startOfWeek, endOfWeek, subWeeks, startOfDay } from 'date-fns';
import {
  AssignmentState,
  BookingStatus,
  ProgramCategory,
} from '@/generated/prisma/client';

export type Role = 'PATH' | 'KIRTAN';
export type Jatha = 'A' | 'B';

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
];

// Overlap for booking (for windowless assignments)
function bookingOverlapWhere(start: Date, end: Date) {
  return { start: { lt: end }, end: { gt: start } };
}

/** staff who are busy in [start,end) */
export async function busyStaffIds(start: Date, end: Date) {
  const rows = await prisma.bookingAssignment.findMany({
    where: {
      // ✅ ignore cancelled/expired bookings
      booking: { status: { in: ACTIVE_BOOKING_STATUSES } },

      // ✅ PROPOSED should block availability (prevents double-proposals)
      state: { in: [AssignmentState.PROPOSED, AssignmentState.CONFIRMED] },

      OR: [
        { start: { lt: end }, end: { gt: start } }, // windowed
        {
          AND: [
            { start: null },
            { end: null },
            { booking: bookingOverlapWhere(start, end) },
          ],
        }, // windowless
      ],
    },
    select: { staffId: true },
  });

  return new Set(rows.map((r) => r.staffId));
}

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

export async function weightedLoadByStaff(
  staffIds: string[],
  windowWeeks = 8,
  roleFilter?: Role
) {
  if (!staffIds.length) return new Map<string, number>();

  // ✅ match report-fairness window semantics (inclusive week count)
  const windowEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
  const windowStart = subWeeks(
    startOfWeek(windowEnd, { weekStartsOn: 1 }),
    Math.max(0, windowWeeks - 1)
  );

  const rows = await prisma.bookingAssignment.findMany({
    where: {
      staffId: { in: staffIds },

      // ✅ fairness load should be based on REAL confirmed work
      state: AssignmentState.CONFIRMED,

      // ✅ ignore cancelled/expired bookings
      booking: { status: { in: ACTIVE_BOOKING_STATUSES } },

      OR: [
        // Count any windowed shift that OVERLAPS [windowStart, windowEnd)
        { AND: [{ start: { lt: windowEnd } }, { end: { gt: windowStart } }] },
        // Count unwindowed rows by the booking overlap
        {
          AND: [
            { start: null },
            { end: null },
            { booking: { start: { lt: windowEnd }, end: { gt: windowStart } } },
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
    return i.localeCompare(j);
  });
}

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
  }

  if (aFree.length === 0 && bFree.length === 0) return null;
  if (aFree.length > bFree.length) return 'A';
  if (bFree.length > aFree.length) return 'B';

  const earlier = await countEarlierDayKirtanWindows(start);
  return earlier % 2 === 0 ? 'A' : 'B';
}

export async function countEarlierDayKirtanWindows(start: Date) {
  const dayStart = startOfDay(start);
  const rows = await prisma.booking.findMany({
    where: {
      start: { gte: dayStart, lt: start },
      status: { in: ACTIVE_BOOKING_STATUSES },
      items: {
        some: {
          programType: {
            OR: [
              { category: ProgramCategory.KIRTAN },
              { trailingKirtanMinutes: { gt: 0 } },
            ],
          },
        },
      },
    },
    select: { id: true },
  });
  return rows.length;
}
