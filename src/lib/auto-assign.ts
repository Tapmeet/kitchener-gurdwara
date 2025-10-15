// src/lib/auto-assign.ts
import { prisma } from '@/lib/db';
import {
  availableJathaMembers,
  availablePathOnly,
  orderByWeightedLoad,
  pickJathaForSlot,
  Role,
  busyStaffIds,
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

// PATH-capable donors from a single jatha (ordered by PATH load)
async function availableJathaPathMembers(
  jatha: 'A' | 'B',
  start: Date,
  end: Date,
  reserved: Set<string> = new Set<string>()
): Promise<string[]> {
  const busy = await busyStaffIds(start, end);
  const rows = await prisma.staff.findMany({
    where: { isActive: true, jatha, skills: { has: 'PATH' } },
    select: { id: true },
  });
  const free = rows
    .map((r) => r.id)
    .filter((id) => !busy.has(id) && !reserved.has(id));
  return orderByWeightedLoad(free, 'PATH');
}

async function pickPathersForWindow(
  start: Date,
  end: Date,
  need: number,
  reserved: Set<string>
): Promise<{ picked: string[]; shortage: number }> {
  if (need <= 0) return { picked: [], shortage: 0 };

  // 1) PATH-only first
  const pathOnly = await availablePathOnly(start, end);
  const pathOnlyOrdered = await orderByWeightedLoad(
    pathOnly.map((s) => s.id),
    'PATH'
  );
  const pOnly = takeFirst(exclude(pathOnlyOrdered, reserved), need);
  let remaining = need - pOnly.length;
  if (remaining <= 0) return { picked: pOnly, shortage: 0 };

  // 2) Borrow from exactly ONE jatha, PATH-capable only
  const donor = await pickJathaForSlot(start, end);
  let donorPool: string[] = [];
  if (donor) {
    donorPool = await availableJathaPathMembers(donor, start, end, reserved);
  }
  const pJ = takeFirst(donorPool, remaining);
  remaining -= pJ.length;

  return { picked: [...pOnly, ...pJ], shortage: Math.max(0, remaining) };
}

async function pickJathaForWindow(start: Date, end: Date) {
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
  // clear any earlier proposals for this booking so we don't accumulate people
  await prisma.bookingAssignment.deleteMany({
    where: { bookingId, state: 'PROPOSED' },
  });

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
              name: true,
            },
          },
        },
      },
    },
  });
  if (!booking) throw new Error('Booking not found');

  const thisBookingId = booking.id;
  const created: AssignResult['created'] = [];
  const shortages: AssignResult['shortages'] = [];
  let pickedJathaOverall: 'A' | 'B' | null = null;

  // Persist helper (creates PROPOSED rows)
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
        state: 'PROPOSED', // review before publish
      })),
      skipDuplicates: true,
    });
    for (const staffId of staffIds)
      created.push({ staffId, bookingItemId: itemId });
  }

  for (const item of booking.items) {
    const pt = item.programType;
    const start = booking.start;
    const end = booking.end;

    // --------------------------
    // STRICT AKHAND (fixed team, rotations, closing double, trailing Kirtan)
    // --------------------------
    const isAkhand = pt.name.toLowerCase().includes('akhand');
    if (isAkhand) {
      // rotation length (fallback 60m)
      const rot = Math.max(60, pt.pathRotationMinutes || 60);

      // windows
      const tk = Math.max(0, pt.trailingKirtanMinutes ?? 0); // trailing Kirtan minutes
      const pathEnd = tk > 0 ? new Date(end.getTime() - tk * 60_000) : end;

      const closingMinutes = Math.max(0, pt.pathClosingDoubleMinutes ?? 0);
      const closingStart =
        closingMinutes > 0
          ? new Date(pathEnd.getTime() - closingMinutes * 60_000)
          : pathEnd;

      // jatha for Kirtan (and can help PATH rotations)
      const { jatha, memberIds } = await pickJathaForWindow(start, end);
      if (!jatha || memberIds.length < JATHA_SIZE) {
        shortages.push({
          itemId: item.id,
          role: 'KIRTAN',
          needed: Math.max(0, JATHA_SIZE - (memberIds.length || 0)),
        });
        continue;
      }
      const orderedJ = (await orderByWeightedLoad(memberIds, 'KIRTAN')).slice(
        0,
        JATHA_SIZE
      );

      // pathi: prefer PATH-only; if none available, borrow PATH-capable from same jatha
      const pathOnly = await availablePathOnly(start, end);
      const pathiFromOnly = (
        await orderByWeightedLoad(
          pathOnly.map((p) => p.id),
          'PATH'
        )
      )[0];
      let pathi = pathiFromOnly;
      if (!pathi) {
        const jathaPath = await availableJathaPathMembers(jatha, start, end);
        pathi = jathaPath[0];
      }
      if (!pathi) {
        shortages.push({ itemId: item.id, role: 'PATH', needed: 1 });
        continue;
      }

      // Fixed team of 4 for rotations
      const team = [pathi, ...orderedJ];

      // 1) PATH rotations from [start, closingStart)
      let cursor = new Date(start);
      let idx = 0;
      while (cursor < closingStart) {
        const slotEnd = new Date(
          Math.min(closingStart.getTime(), cursor.getTime() + rot * 60_000)
        );
        const who = team[idx % team.length];
        await commit(item.id, [who], cursor, slotEnd);
        idx += 1;
        cursor = slotEnd;
      }

      // 2) Closing double PATH: two people on [closingStart, pathEnd)
      if (closingMinutes > 0 && closingStart < pathEnd) {
        // make sure they are distinct
        const secondPref = orderedJ[0];
        const second =
          secondPref && secondPref !== pathi
            ? secondPref
            : (orderedJ[1] ?? team[1]);
        const closingPair = [pathi, second].filter(Boolean) as string[];

        if (closingPair.length < 2) {
          shortages.push({
            itemId: item.id,
            role: 'PATH',
            needed: 2 - closingPair.length,
          });
        } else {
          await prisma.bookingAssignment.createMany({
            data: closingPair.map((staffId) => ({
              bookingId: booking.id,
              bookingItemId: item.id,
              staffId,
              start: closingStart,
              end: pathEnd,
              state: 'PROPOSED',
            })),
            skipDuplicates: true,
          });
        }
      }

      // 3) Trailing Kirtan (if any) on [pathEnd, end)
      if (tk > 0) {
        await commit(item.id, orderedJ, pathEnd, end);
      }

      continue; // skip non-Akhand flow
    }

    // --------------------------
    // NON-AKHAND: split into PATH and KIRTAN windows per ProgramType rules
    // --------------------------
    const minK = Math.max(0, pt.minKirtanis ?? 0);
    const minP = Math.max(0, pt.minPathers ?? 0);
    const ppl = Math.max(pt.peopleRequired ?? 0, minK + minP);

    const tk = Math.max(0, pt.trailingKirtanMinutes ?? 0); // jatha only at end
    const rot = Math.max(0, pt.pathRotationMinutes ?? 0); // path rotation length
    const closingDouble = Math.max(0, pt.pathClosingDoubleMinutes ?? 0); // last minutes need 2 pathis

    const kirtanStart = tk > 0 ? new Date(end.getTime() - tk * 60_000) : null;
    const pathStart = start;
    const pathEnd = kirtanStart ?? end;

    // Reserve set so we don't double-book K & P in the same exact window
    const reservedConcurrent = new Set<string>();

    // --- KIRTAN ---
    if (minK > 0 && tk === 0) {
      // Full-window Kirtan [start, end]
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
        picksK.forEach((id) => reservedConcurrent.add(id));
        await commit(item.id, picksK, start, end);
      }
    }

    if (tk > 0) {
      // Kirtan only at the tail [kirtanStart, end]
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

    // --- PATH ---
    if (minP > 0) {
      if (rot > 0) {
        // Rotation region [pathStart, closingStart)
        const closingStart =
          closingDouble > 0
            ? new Date(pathEnd.getTime() - closingDouble * 60_000)
            : pathEnd;

        let cursor = new Date(pathStart);
        while (cursor < closingStart) {
          const slotEnd = new Date(
            Math.min(cursor.getTime() + rot * 60_000, closingStart.getTime())
          );
          const localReserved = new Set<string>(reservedConcurrent);
          const { picked, shortage } = await pickPathersForWindow(
            cursor,
            slotEnd,
            minP,
            localReserved
          );
          if (shortage > 0) {
            shortages.push({ itemId: item.id, role: 'PATH', needed: shortage });
          }
          if (picked.length > 0) {
            await commit(item.id, picked, cursor, slotEnd);
          }
          cursor = slotEnd;
        }

        // Closing double window [closingStart, pathEnd): need 2 pathis minimum
        if (closingDouble > 0 && closingStart < pathEnd) {
          const needDouble = Math.max(2, minP);
          const { picked, shortage } = await pickPathersForWindow(
            closingStart,
            pathEnd,
            needDouble,
            new Set<string>()
          );
          if (shortage > 0) {
            shortages.push({ itemId: item.id, role: 'PATH', needed: shortage });
          }
          if (picked.length > 0) {
            await commit(item.id, picked, closingStart, pathEnd);
          }
        }
      } else {
        // No rotation: PATH over [pathStart, pathEnd]
        const { picked, shortage } = await pickPathersForWindow(
          pathStart,
          pathEnd,
          minP,
          reservedConcurrent
        );
        if (shortage > 0) {
          shortages.push({ itemId: item.id, role: 'PATH', needed: shortage });
        }
        if (picked.length > 0) {
          await commit(item.id, picked, pathStart, pathEnd);
        }
      }
    }

    // --- FLEX (short windows only; fills up to peopleRequired without spamming long events) ---
    const totalMinutes = Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 60_000)
    );
    const isShort = totalMinutes <= 240; // <= 4h
    if (isShort && ppl > minK + minP && tk === 0 && minK > 0) {
      // Only when Kirtan runs full window
      const already = await prisma.bookingAssignment.findMany({
        where: { bookingId: thisBookingId, bookingItemId: item.id },
        select: { staffId: true },
      });
      const have = new Set(already.map((a) => a.staffId));
      const want = Math.max(0, ppl - have.size);

      if (want > 0) {
        // Prefer PATH-only, then same jatha as Kirtan if we can detect it
        const pathOnly2 = await availablePathOnly(start, end);
        const pathOnlyOrdered2 = await orderByWeightedLoad(
          exclude(
            pathOnly2.map((s) => s.id),
            have
          ),
          'PATH'
        );

        let flexPool = [...pathOnlyOrdered2];

        const kAsns = await prisma.bookingAssignment.findMany({
          where: { bookingId: thisBookingId, bookingItemId: item.id },
          include: { staff: { select: { jatha: true } } },
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
