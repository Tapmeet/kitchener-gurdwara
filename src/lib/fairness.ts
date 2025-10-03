
// src/lib/fairness.ts
import { prisma } from "@/lib/db";
import { startOfWeek, endOfWeek, subWeeks } from "date-fns";
import type { ProgramCategory } from "@prisma/client";

export type Role = "PATH" | "KIRTAN";

export function overlapWhere(start: Date, end: Date) {
  return { start: { lt: end }, end: { gt: start } };
}

export async function busyStaffIds(start: Date, end: Date) {
  const rows = await prisma.bookingAssignment.findMany({
    where: { booking: overlapWhere(start, end) },
    select: { staffId: true },
  });
  return new Set(rows.map((r) => r.staffId));
}

export async function availableJathaMembers(
  jatha: "A" | "B",
  start: Date,
  end: Date
) {
  const busy = await busyStaffIds(start, end);
  const rows = await prisma.staff.findMany({
    where: { isActive: true, jatha, skills: { hasEvery: ["KIRTAN", "PATH"] } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows.filter((r) => !busy.has(r.id));
}

export async function availablePathOnly(start: Date, end: Date) {
  const busy = await busyStaffIds(start, end);
  const rows = await prisma.staff.findMany({
    where: {
      isActive: true,
      skills: { has: "PATH" },
      NOT: { skills: { has: "KIRTAN" } },
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

  const end = endOfWeek(new Date(), { weekStartsOn: 1 });
  const start = subWeeks(startOfWeek(end, { weekStartsOn: 1 }), windowWeeks);

  const rows = await prisma.bookingAssignment.findMany({
    where: {
      staffId: { in: staffIds },
      booking: { start: { gte: start }, end: { lte: end } },
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

export async function pickJathaForSlot(start: Date, end: Date) {
  const busy = await busyStaffIds(start, end);

  const aMembers = await prisma.staff.findMany({
    where: { isActive: true, jatha: "A", skills: { hasEvery: ["KIRTAN", "PATH"] } },
    select: { id: true },
  });
  const bMembers = await prisma.staff.findMany({
    where: { isActive: true, jatha: "B", skills: { hasEvery: ["KIRTAN", "PATH"] } },
    select: { id: true },
  });

  const aBusyCount = aMembers.filter((m) => busy.has(m.id)).length;
  const bBusyCount = bMembers.filter((m) => busy.has(m.id)).length;

  if (aBusyCount > 0 && aBusyCount < 3) return "A" as const;
  if (bBusyCount > 0 && bBusyCount < 3) return "B" as const;

  const aFree = aMembers.filter((m) => !busy.has(m.id)).length >= 3;
  const bFree = bMembers.filter((m) => !busy.has(m.id)).length >= 3;

  if (aFree) return "A" as const;
  if (bFree) return "B" as const;

  return null;
}

export async function orderByWeightedLoad(
  ids: string[],
  role: Role,
  windowWeeks = 8
) {
  const loads = await weightedLoadByStaff(ids, windowWeeks, role);
  return [...ids].sort((i, j) => (loads.get(i)! - loads.get(j)!));
}
