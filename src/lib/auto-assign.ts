import { prisma } from "@/lib/db";
import { startOfWeek, endOfWeek } from "date-fns";
import { ProgramCategory } from "@prisma/client";

type Role = "PATH" | "KIRTAN";

export type AssignResult = {
  created: { staffId: string; bookingItemId: string; role: Role }[];
  shortages: { itemId: string; role: Role; needed: number }[];
};

function overlapWhere(startAt: Date, endAt: Date) {
  return { start: { lt: endAt }, end: { gt: startAt } };
}

async function busyStaffIds(startAt: Date, endAt: Date) {
  const rows = await prisma.bookingAssignment.findMany({
    where: { booking: overlapWhere(startAt, endAt) },
    select: { staffId: true },
  });
  return new Set(rows.map((r) => r.staffId));
}

async function orderStaffByWeeklyCategoryLoad(
  staffIds: string[],
  category: ProgramCategory,
  weekOf: Date
) {
  if (!staffIds.length) return [];
  const ws = startOfWeek(weekOf, { weekStartsOn: 1 });
  const we = endOfWeek(weekOf, { weekStartsOn: 1 });

  const rows = await prisma.bookingAssignment.findMany({
    where: {
      staffId: { in: staffIds },
      booking: { start: { gte: ws }, end: { lte: we } },
      bookingItem: { programType: { category } },
    },
    select: { staffId: true },
  });

  const counts = new Map<string, number>();
  for (const id of staffIds) counts.set(id, 0);
  for (const r of rows) counts.set(r.staffId, (counts.get(r.staffId) ?? 0) + 1);

  return staffIds.sort((a, b) => (counts.get(a)! - counts.get(b)!));
}

export async function autoAssignForBooking(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { items: { include: { programType: true } } },
  });
  if (!booking) throw new Error("Booking not found");

  const created: { staffId: string; bookingItemId: string; role: Role }[] = [];
  const shortages: { itemId: string; role: Role; needed: number }[] = [];

  const startAt = booking.start;
  const endAt = booking.end;
  const busy = await busyStaffIds(startAt, endAt);

  const kirtanItems = booking.items.filter(
    (i) =>
      i.programType.category === ProgramCategory.KIRTAN ||
      (i.programType.minKirtanis ?? 0) > 0
  );
  const pathItems = booking.items.filter(
    (i) =>
      i.programType.category === ProgramCategory.PATH ||
      (i.programType.minPathers ?? 0) > 0
  );

  // Kirtan
  if (kirtanItems.length) {
    const allK = await prisma.staff.findMany({
      where: { isActive: true, skills: { has: "KIRTAN" } },
      select: { id: true },
    });
    const freeK = allK.filter((s) => !busy.has(s.id)).map((s) => s.id);
    const orderedK = await orderStaffByWeeklyCategoryLoad(
      freeK,
      ProgramCategory.KIRTAN,
      startAt
    );
    for (const item of kirtanItems) {
      const need = Math.max(1, item.programType.minKirtanis ?? 0) || 3;
      const existing = await prisma.bookingAssignment.count({ where: { bookingItemId: item.id } });
      const remaining = Math.max(0, need - existing);
      if (remaining <= 0) continue;

      const take = orderedK.slice(0, remaining);
      if (!take.length) {
        shortages.push({ itemId: item.id, role: "KIRTAN", needed: remaining });
        continue;
      }
      await prisma.bookingAssignment.createMany({
        data: take.map((id) => ({ bookingId: booking.id, bookingItemId: item.id, staffId: id })),
        skipDuplicates: true,
      });
      take.forEach((id) => created.push({ staffId: id, bookingItemId: item.id, role: "KIRTAN" }));
    }
  }

  // Path
  if (pathItems.length) {
    const granthi = await prisma.staff.findFirst({
      where: { isActive: true, skills: { has: "PATH" }, name: { equals: "Granthi", mode: "insensitive" } },
      select: { id: true },
    });
    const granthiFree = granthi && !busy.has(granthi.id) ? granthi.id : null;

    const allP = await prisma.staff.findMany({
      where: { isActive: true, skills: { has: "PATH" } },
      select: { id: true },
    });
    const freeP = allP.filter((s) => !busy.has(s.id)).map((s) => s.id);
    const orderedP = await orderStaffByWeeklyCategoryLoad(freeP, ProgramCategory.PATH, startAt);

    for (const item of pathItems) {
      const need = Math.max(1, item.programType.minPathers ?? 0);
      const existing = await prisma.bookingAssignment.count({ where: { bookingItemId: item.id } });
      let remaining = Math.max(0, need - existing);
      if (remaining <= 0) continue;

      if (granthiFree && remaining > 0) {
        await prisma.bookingAssignment.create({
          data: { bookingId: booking.id, bookingItemId: item.id, staffId: granthiFree },
        });
        created.push({ staffId: granthiFree, bookingItemId: item.id, role: "PATH" });
        remaining--;
      }

      if (remaining > 0) {
        const take = orderedP.slice(0, remaining);
        if (!take.length) {
          shortages.push({ itemId: item.id, role: "PATH", needed: remaining });
        } else {
          await prisma.bookingAssignment.createMany({
            data: take.map((id) => ({ bookingId: booking.id, bookingItemId: item.id, staffId: id })),
            skipDuplicates: true,
          });
          take.forEach((id) => created.push({ staffId: id, bookingItemId: item.id, role: "PATH" }));
        }
      }
    }
  }

  return { created, shortages };
}
