// src/lib/auto-assign.ts
import { prisma } from '@/lib/db';
import {
  availableJathaMembers,
  availablePathOnly,
  orderByWeightedLoad,
  pickJathaForSlot,
  Role,
} from '@/lib/fairness';
import { JATHA_SIZE } from '@/lib/jatha';

export type AssignResult = {
  created: { staffId: string; bookingItemId: string }[];
  shortages: { itemId: string; role: Role | 'FLEX'; needed: number }[];
  pickedJatha?: 'A' | 'B' | null;
};

function takeFirst<T>(arr: T[], n: number) {
  return arr.slice(0, Math.max(0, n));
}
function exclude<T>(arr: T[], excludeSet: Set<T>) {
  return arr.filter((x) => !excludeSet.has(x));
}

async function pickPathersForWindow(
  start: Date,
  end: Date,
  need: number,
  reserved: Set<string>
): Promise<{ picked: string[]; shortage: number }> {
  if (need <= 0) return { picked: [], shortage: 0 };

  // PATH-only first (granthi etc.)
  const pathOnly = await availablePathOnly(start, end);
  const pathOnlyOrdered = await orderByWeightedLoad(
    pathOnly.map((s) => s.id),
    'PATH'
  );
  const pOnly = takeFirst(exclude(pathOnlyOrdered, reserved), need);
  let remaining = need - pOnly.length;

  if (remaining <= 0) return { picked: pOnly, shortage: 0 };

  // If still short, draw from exactly ONE jatha (to avoid breaking both)
  const donor = await pickJathaForSlot(start, end);
  let donorPool: string[] = [];
  if (donor) {
    const donorAvail = await availableJathaMembers(donor, start, end);
    const donorOrdered = await orderByWeightedLoad(
      donorAvail.map((s) => s.id),
      'PATH'
    );
    donorPool = exclude(donorOrdered, reserved);
  }

  const pJ = takeFirst(donorPool, remaining);
  remaining -= pJ.length;

  return {
    picked: [...pOnly, ...pJ],
    shortage: Math.max(0, remaining),
  };
}

async function pickJathaForWindow(
  start: Date,
  end: Date
): Promise<{ jatha: 'A' | 'B' | null; memberIds: string[] }> {
  const primary = await pickJathaForSlot(start, end);
  const order: (('A' | 'B') | null)[] =
    primary === 'A' ? ['A', 'B'] : primary === 'B' ? ['B', 'A'] : [null];

  for (const choice of order) {
    if (!choice) break;
    const avail = await availableJathaMembers(choice, start, end);
    if (avail.length >= JATHA_SIZE)
      return { jatha: choice, memberIds: avail.map((s) => s.id) };
  }
  return { jatha: null, memberIds: [] };
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
              trailingKirtanMinutes: true,
              pathRotationMinutes: true,
              pathClosingDoubleMinutes: true,
            },
          },
        },
      },
    },
  });
  if (!booking) throw new Error('Booking not found');

  // ✅ capture non-null id so nested functions don't see a nullable value
  const thisBookingId: string = booking.id;

  const start = booking.start;
  const end = booking.end;

  const created: AssignResult['created'] = [];
  const shortages: AssignResult['shortages'] = [];
  let pickedJathaOverall: 'A' | 'B' | null = null;

  // Helper to persist assignments (optionally windowed)
  async function commit(
    itemId: string,
    staffIds: string[],
    winStart?: Date,
    winEnd?: Date
  ) {
    if (!staffIds.length) return;
    await prisma.bookingAssignment.createMany({
      data: staffIds.map((staffId) => ({
        bookingId: thisBookingId,
        bookingItemId: itemId,
        staffId,
        start: winStart ?? null,
        end: winEnd ?? null,
      })),
      skipDuplicates: true,
    });
    for (const staffId of staffIds) {
      created.push({ staffId, bookingItemId: itemId });
    }
  }

  for (const item of booking.items) {
    const pt = item.programType;

    const minK = Math.max(0, pt.minKirtanis ?? 0);
    const minP = Math.max(0, pt.minPathers ?? 0);
    const ppl = Math.max(pt.peopleRequired ?? 0, minK + minP);

    const tk = Math.max(0, pt.trailingKirtanMinutes ?? 0);
    const rot = Math.max(0, pt.pathRotationMinutes ?? 0);
    const closingDouble = Math.max(0, pt.pathClosingDoubleMinutes ?? 0);

    // Windows
    const kirtanStart = tk > 0 ? new Date(end.getTime() - tk * 60_000) : null;
    const pathEnd = kirtanStart ?? end;
    const pathStart = start;

    // Track concurrent reservations within the same time window to avoid double-picking
    // (we reset this for non-overlapping windows like rotations).
    const reservedConcurrent = new Set<string>();

    // --------------------------
    // 1) KIRTAN assignments
    // --------------------------
    if (minK > 0 && tk === 0) {
      // Kirtan throughout the entire item window [start, end] (e.g., Anand Karaj)
      const { jatha, memberIds } = await pickJathaForWindow(start, end);
      if (!jatha || memberIds.length < JATHA_SIZE) {
        shortages.push({
          itemId: item.id,
          role: 'KIRTAN',
          needed: Math.max(0, JATHA_SIZE - (memberIds.length || 0)),
        });
      } else {
        const jathaOrder = await orderByWeightedLoad(memberIds, 'KIRTAN');
        const picksK = jathaOrder.slice(0, JATHA_SIZE);
        pickedJathaOverall = pickedJathaOverall ?? jatha;
        // reserve jatha picks against concurrent PATH in the same window
        picksK.forEach((id) => reservedConcurrent.add(id));
        await commit(item.id, picksK, start, end);
      }
    }

    if (tk > 0) {
      // Kirtan only at the end [kirtanStart, end]
      const ks = kirtanStart!;
      const { jatha, memberIds } = await pickJathaForWindow(ks, end);
      if (!jatha || memberIds.length < JATHA_SIZE) {
        shortages.push({
          itemId: item.id,
          role: 'KIRTAN',
          needed: Math.max(0, JATHA_SIZE - (memberIds.length || 0)),
        });
      } else {
        const order = await orderByWeightedLoad(memberIds, 'KIRTAN');
        const picksK = order.slice(0, JATHA_SIZE);
        pickedJathaOverall = pickedJathaOverall ?? jatha;
        await commit(item.id, picksK, ks, end);
      }
    }

    // --------------------------
    // 2) PATH assignments
    // --------------------------
    if (minP > 0) {
      // Rotation-based PATH body
      if (rot > 0) {
        // Main rotation region [pathStart, closingStart)
        const closingStart =
          closingDouble > 0
            ? new Date(pathEnd.getTime() - closingDouble * 60_000)
            : pathEnd;

        let cursor = new Date(pathStart);
        while (cursor < closingStart) {
          const slotEnd = new Date(
            Math.min(cursor.getTime() + rot * 60_000, closingStart.getTime())
          );

          // fresh window-local reservations (no need to exclude past slots)
          const localReserved = new Set<string>(reservedConcurrent);

          const { picked, shortage } = await pickPathersForWindow(
            cursor,
            slotEnd,
            minP,
            localReserved
          );
          if (shortage > 0) {
            shortages.push({
              itemId: item.id,
              role: 'PATH',
              needed: shortage,
            });
          }
          if (picked.length > 0) {
            await commit(item.id, picked, cursor, slotEnd);
          }
          cursor = slotEnd;
        }

        // Closing double window [closingStart, pathEnd): require 2 pathis
        if (closingDouble > 0 && closingStart < pathEnd) {
          const needDouble = Math.max(2, minP); // 2 pathis minimum
          const { picked, shortage } = await pickPathersForWindow(
            closingStart,
            pathEnd,
            needDouble,
            new Set<string>() // new window
          );
          if (shortage > 0) {
            shortages.push({
              itemId: item.id,
              role: 'PATH',
              needed: shortage,
            });
          }
          if (picked.length > 0) {
            await commit(item.id, picked, closingStart, pathEnd);
          }
        }
      } else {
        // No rotation: assign PATH over the entire path window [pathStart, pathEnd]
        const { picked, shortage } = await pickPathersForWindow(
          pathStart,
          pathEnd,
          minP,
          reservedConcurrent
        );
        if (shortage > 0) {
          shortages.push({
            itemId: item.id,
            role: 'PATH',
            needed: shortage,
          });
        }
        if (picked.length > 0) {
          await commit(item.id, picked, pathStart, pathEnd);
        }
      }
    }

    // --------------------------
    // 3) OPTIONAL FLEX (short slots only)
    // --------------------------
    // For very long windows (e.g., 48–49h) we skip trying to fill to `peopleRequired`
    // to avoid spamming giant assignment sets. Keep FLEX only for short, concurrent items.
    const totalMinutes = Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 60_000)
    );
    const isShort = totalMinutes <= 240; // <= 4h

    if (isShort && ppl > minK + minP && tk === 0 && minK > 0) {
      // Only consider FLEX when Kirtan runs the whole window (e.g., Anand Karaj).
      // At this point, K (jatha) has been reserved; add extra helpers up to ppl
      // without breaking the other jatha.
      const already = await prisma.bookingAssignment.findMany({
        where: { bookingId: thisBookingId, bookingItemId: item.id },
        select: { staffId: true },
      });
      const have = new Set(already.map((a) => a.staffId));
      const want = Math.max(0, ppl - have.size);

      if (want > 0) {
        // Prefer PATH-only, then same jatha as the Kirtan
        const pathOnly = await availablePathOnly(start, end);
        const pathOnlyOrdered = await orderByWeightedLoad(
          exclude(
            pathOnly.map((s) => s.id),
            have
          ),
          'PATH'
        );

        let flexPool = [...pathOnlyOrdered];

        // Try to detect which jatha was used for K
        const kAsns = await prisma.bookingAssignment.findMany({
          where: { bookingId: thisBookingId, bookingItemId: item.id },
          include: {
            staff: { select: { jatha: true } },
          },
        });
        const kJatha =
          kAsns.find((a) => a.staff.jatha != null)?.staff.jatha ?? null;

        if (kJatha) {
          const jAvail = await availableJathaMembers(kJatha, start, end);
          const jOrdered = await orderByWeightedLoad(
            exclude(
              jAvail.map((s) => s.id),
              have
            ),
            'KIRTAN'
          );
          flexPool = [...flexPool, ...jOrdered];
        }

        const flexPicks = takeFirst(exclude(flexPool, have), want);
        if (flexPicks.length < want) {
          shortages.push({
            itemId: item.id,
            role: 'FLEX',
            needed: want - flexPicks.length,
          });
        }
        if (flexPicks.length) {
          await commit(item.id, flexPicks, start, end);
        }
      }
    }
  }

  return { created, shortages, pickedJatha: pickedJathaOverall ?? null };
}
