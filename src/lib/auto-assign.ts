// src/lib/auto-assign.ts
import { prisma } from '@/lib/db';
import {
  availableJathaMembers,
  availablePathOnly,
  orderByWeightedLoad,
  pickJathaForSlot,
  Role,
} from '@/lib/fairness';

export type AssignResult = {
  created: { staffId: string; bookingItemId: string }[];
  shortages: { itemId: string; role: Role; needed: number }[];
  pickedJatha?: 'A' | 'B' | null;
};

export async function autoAssignForBooking(
  bookingId: string
): Promise<AssignResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { items: { include: { programType: true } } },
  });
  if (!booking) throw new Error('Booking not found');

  const start = booking.start;
  const end = booking.end;

  const created: AssignResult['created'] = [];
  const shortages: AssignResult['shortages'] = [];

  const kirtanItems = booking.items.filter(
    (i) =>
      i.programType.category === 'KIRTAN' ||
      (i.programType.minKirtanis ?? 0) > 0
  );
  const pathItems = booking.items.filter(
    (i) =>
      i.programType.category === 'PATH' || (i.programType.minPathers ?? 0) > 0
  );

  // KIRTAN
  let chosenJatha: 'A' | 'B' | null = null;
  if (kirtanItems.length) {
    chosenJatha = (await pickJathaForSlot(start, end)) ?? null;
    if (chosenJatha) {
      let avail = await availableJathaMembers(chosenJatha, start, end);
      const ordered = await orderByWeightedLoad(
        avail.map((m) => m.id),
        'KIRTAN'
      );
      const trio = ordered.slice(0, 3);

      for (const item of kirtanItems) {
        if (trio.length < 3) {
          shortages.push({
            itemId: item.id,
            role: 'KIRTAN',
            needed: 3 - trio.length,
          });
          continue;
        }
        await prisma.bookingAssignment.createMany({
          data: trio.map((staffId) => ({
            bookingId: booking.id,
            bookingItemId: item.id,
            staffId,
          })),
          skipDuplicates: true,
        });
        trio.forEach((staffId) =>
          created.push({ staffId, bookingItemId: item.id })
        );
      }
    } else {
      for (const item of kirtanItems) {
        shortages.push({ itemId: item.id, role: 'KIRTAN', needed: 3 });
      }
    }
  }

  // PATH
  if (pathItems.length) {
    const pathOnly = await availablePathOnly(start, end);
    const pathOnlyOrdered = await orderByWeightedLoad(
      pathOnly.map((p) => p.id),
      'PATH'
    );

    const jathaFirst = chosenJatha ?? (await pickJathaForSlot(start, end));
    const jathaSecond =
      jathaFirst === 'A' ? 'B' : jathaFirst === 'B' ? 'A' : null;

    const j1Avail = jathaFirst
      ? await availableJathaMembers(jathaFirst, start, end)
      : [];
    const j2Avail = jathaSecond
      ? await availableJathaMembers(jathaSecond, start, end)
      : [];

    const j1Ordered = await orderByWeightedLoad(
      j1Avail.map((m) => m.id),
      'PATH'
    );
    const j2Ordered = await orderByWeightedLoad(
      j2Avail.map((m) => m.id),
      'PATH'
    );

    for (const item of pathItems) {
      const need = Math.max(1, item.programType.minPathers ?? 1);
      const existing = await prisma.bookingAssignment.count({
        where: {
          bookingItemId: item.id,
          staff: { skills: { has: 'PATH' } },
        },
      });
      let remaining = Math.max(0, need - existing);
      if (remaining <= 0) continue;

      const picks: string[] = [];

      for (const sid of pathOnlyOrdered) {
        if (remaining <= 0) break;
        if (!picks.includes(sid)) {
          picks.push(sid);
          remaining--;
        }
      }

      if (remaining > 0) {
        for (const sid of j1Ordered) {
          if (remaining <= 0) break;
          if (!picks.includes(sid)) {
            picks.push(sid);
            remaining--;
          }
        }
      }

      if (remaining > 0) {
        for (const sid of j2Ordered) {
          if (remaining <= 0) break;
          if (!picks.includes(sid)) {
            picks.push(sid);
            remaining--;
          }
        }
      }

      if (picks.length) {
        await prisma.bookingAssignment.createMany({
          data: picks.map((staffId) => ({
            bookingId: booking.id,
            bookingItemId: item.id,
            staffId,
          })),
          skipDuplicates: true,
        });
        picks.forEach((staffId) =>
          created.push({ staffId, bookingItemId: item.id })
        );
      }

      if (remaining > 0) {
        shortages.push({ itemId: item.id, role: 'PATH', needed: remaining });
      }
    }
  }

  return { created, shortages, pickedJatha: chosenJatha };
}
