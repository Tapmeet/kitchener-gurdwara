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
  shortages: { itemId: string; role: Role | 'FLEX'; needed: number }[];
  pickedJatha?: 'A' | 'B' | null;
};

function diff<T>(ids: T[], reserved: Set<T>) {
  return ids.filter((id) => !reserved.has(id));
}
function takeFirst<T>(arr: T[], n: number) {
  return arr.slice(0, Math.max(0, n));
}

export async function autoAssignForBooking(
  bookingId: string
): Promise<AssignResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      items: {
        include: {
          programType: {
            select: {
              id: true,
              category: true,
              minKirtanis: true,
              minPathers: true,
              peopleRequired: true,
            },
          },
        },
      },
    },
  });
  if (!booking) throw new Error('Booking not found');

  const start = booking.start;
  const end = booking.end;

  // Collect items that require each role
  const items = booking.items;
  const anyKirtan = items.some(
    (i) =>
      (i.programType.minKirtanis ?? 0) > 0 ||
      i.programType.category === 'KIRTAN'
  );

  // We’ll reserve staff locally as we assign, so we don’t double-book within this single booking window.
  const reserved = new Set<string>();
  const created: AssignResult['created'] = [];
  const shortages: AssignResult['shortages'] = [];

  // Precompute availability lists once for the window
  const chosenJatha: 'A' | 'B' | null = anyKirtan
    ? ((await pickJathaForSlot(start, end)) ?? null)
    : null;
  const jathaFirst = chosenJatha;
  const jathaSecond =
    jathaFirst === 'A' ? 'B' : jathaFirst === 'B' ? 'A' : null;

  const pathOnlyAvail = await availablePathOnly(start, end); // { id: string }[]
  const j1Avail = jathaFirst
    ? await availableJathaMembers(jathaFirst, start, end)
    : [];
  const j2Avail = jathaSecond
    ? await availableJathaMembers(jathaSecond, start, end)
    : [];

  // role-weighted orderings (we’ll filter reserved as we pick)
  const pathOnly_ordered_PATH = await orderByWeightedLoad(
    pathOnlyAvail.map((p) => p.id),
    'PATH'
  );
  const j1_ordered_KIRTAN = await orderByWeightedLoad(
    j1Avail.map((m) => m.id),
    'KIRTAN'
  );
  const j1_ordered_PATH = await orderByWeightedLoad(
    j1Avail.map((m) => m.id),
    'PATH'
  );
  const j2_ordered_KIRTAN = await orderByWeightedLoad(
    j2Avail.map((m) => m.id),
    'KIRTAN'
  );
  const j2_ordered_PATH = await orderByWeightedLoad(
    j2Avail.map((m) => m.id),
    'PATH'
  );

  // Helper to assign a set of staffIds to one item
  async function commit(itemId: string, staffIds: string[]) {
    if (!staffIds.length) return;
    if (!booking) throw new Error('Booking not found');
    await prisma.bookingAssignment.createMany({
      data: staffIds.map((staffId) => ({
        bookingId: booking.id,
        bookingItemId: itemId,
        staffId,
      })),
      skipDuplicates: true,
    });
    staffIds.forEach((staffId) => {
      reserved.add(staffId);
      created.push({ staffId, bookingItemId: itemId });
    });
  }

  // Assign per item (respecting role mins and then flex up to peopleRequired)
  for (const item of items) {
    const pt = item.programType;
    const minK = Math.max(0, pt.minKirtanis ?? 0);
    const minP = Math.max(0, pt.minPathers ?? 0);
    const minSum = minK + minP;
    const ppl = Math.max(pt.peopleRequired ?? minSum, minSum); // ensure at least the sum of mins
    let picksK: string[] = [];
    let picksP: string[] = [];

    // 1) Kirtanis first (if required)
    if (minK > 0) {
      if (!chosenJatha) {
        shortages.push({ itemId: item.id, role: 'KIRTAN', needed: minK });
      } else {
        const k1 = takeFirst(diff(j1_ordered_KIRTAN, reserved), minK);
        let needLeft = minK - k1.length;
        const k2 =
          needLeft > 0
            ? takeFirst(diff(j2_ordered_KIRTAN, reserved), needLeft)
            : [];
        picksK = [...k1, ...k2];
        if (picksK.length < minK) {
          shortages.push({
            itemId: item.id,
            role: 'KIRTAN',
            needed: minK - picksK.length,
          });
        }
      }
    }

    // 2) Pathers (if required)
    if (minP > 0) {
      const pOnly = takeFirst(diff(pathOnly_ordered_PATH, reserved), minP);
      let needLeft = minP - pOnly.length;
      const pJ1 =
        needLeft > 0
          ? takeFirst(diff(j1_ordered_PATH, reserved), needLeft)
          : [];
      needLeft = minP - (pOnly.length + pJ1.length);
      const pJ2 =
        needLeft > 0
          ? takeFirst(diff(j2_ordered_PATH, reserved), needLeft)
          : [];
      picksP = [...pOnly, ...pJ1, ...pJ2];
      if (picksP.length < minP) {
        shortages.push({
          itemId: item.id,
          role: 'PATH',
          needed: minP - picksP.length,
        });
      }
    }

    // 3) FLEX up to peopleRequired (remaining after mins)
    const already = new Set([...picksK, ...picksP]);
    const have = already.size;
    const want = Math.max(ppl - have, 0);

    if (want > 0) {
      // Compose a reasonable order for flex: prefer jatha-first pool (PATH weight), then jatha-second, then path-only.
      // We also allow using the Kirtan-ordered list to balance load where appropriate.
      const flexOrder = [
        ...diff(j1_ordered_PATH, new Set([...reserved, ...already])),
        ...diff(j2_ordered_PATH, new Set([...reserved, ...already])),
        ...diff(j1_ordered_KIRTAN, new Set([...reserved, ...already])),
        ...diff(j2_ordered_KIRTAN, new Set([...reserved, ...already])),
        ...diff(pathOnly_ordered_PATH, new Set([...reserved, ...already])),
      ];

      const flexPicks = takeFirst(flexOrder, want);
      if (flexPicks.length < want) {
        shortages.push({
          itemId: item.id,
          role: 'FLEX',
          needed: want - flexPicks.length,
        });
      }
      await commit(item.id, [...already, ...flexPicks]); // commit all at once
      continue;
    }

    // Commit mins only (no flex needed)
    await commit(item.id, [...already]);
  }

  return { created, shortages, pickedJatha: chosenJatha };
}
