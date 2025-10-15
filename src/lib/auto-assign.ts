// src/lib/auto-assign.ts
import { prisma } from '@/lib/db';
import {
  availableJathaMembers,
  availablePathOnly,
  orderByWeightedLoad,
  pickJathaForSlot,
  Role,
  busyStaffIds, // ⬅ NEW: to filter jatha donors by availability
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

// ⬇⬇⬇ NEW: when borrowing PATH from a jatha, require PATH skill (not just Kirtan).
async function availableJathaPathMembers(
  jatha: 'A' | 'B',
  start: Date,
  end: Date,
  reserved: Set<string> = new Set<string>()
): Promise<string[]> {
  const busy = await busyStaffIds(start, end);
  const rows = await prisma.staff.findMany({
    where: {
      isActive: true,
      jatha,
      skills: { has: 'PATH' }, // <- must be able to do PATH
    },
    select: { id: true },
  });
  const freeIds = rows
    .map((r) => r.id)
    .filter((id) => !busy.has(id) && !reserved.has(id));
  // order by PATH load to keep it fair
  const ordered = await orderByWeightedLoad(freeIds, 'PATH');
  return ordered;
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
    // ⬇⬇⬇ use PATH-capable members of that jatha only
    donorPool = await availableJathaPathMembers(donor, start, end, reserved);
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
              name: true,
            },
          },
        },
      },
    },
  });
  if (!booking) throw new Error('Booking not found');

  const thisBookingId: string = booking.id;

  const created: AssignResult['created'] = [];
  const shortages: AssignResult['shortages'] = [];
  let pickedJathaOverall: 'A' | 'B' | null = null;

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
        state: 'PROPOSED', 
      })),
      skipDuplicates: true,
    });
    for (const staffId of staffIds) {
      created.push({ staffId, bookingItemId: itemId });
    }
  }

  for (const item of booking.items) {
    const pt = item.programType;
    const start = booking.start;
    const end = booking.end;

    const isAkhand = pt.name.toLowerCase().includes('akhand');
    if (isAkhand) {
      // STRICT AKHAND: pick 1 Pathi + 1 Jatha (3) → 4 fixed people total
      const rot = Math.max(60, pt.pathRotationMinutes || 60); // default 1h
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

      // Prefer a PATH-only granthi; if none, borrow a PATH-capable member from the SAME jatha
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
        pathi = jathaPath[0]; // still keeps team size 4 max
      }
      if (!pathi) {
        shortages.push({ itemId: item.id, role: 'PATH', needed: 1 });
        continue;
      }

      const team = [pathi, ...orderedJ]; // 4 people

      // windowed rotation across the fixed team
      let cursor = new Date(start);
      let idx = 0;
      const batch: {
        bookingId: string;
        bookingItemId: string;
        staffId: string;
        start: Date;
        end: Date;
      }[] = [];

      while (cursor < end) {
        const slotEnd = new Date(
          Math.min(end.getTime(), cursor.getTime() + rot * 60_000)
        );
        const staffId = team[idx % team.length];
        batch.push({
          bookingId: booking.id,
          bookingItemId: item.id,
          staffId,
          start: cursor,
          end: slotEnd,
        });
        idx += 1;
        cursor = slotEnd;
      }

      if (batch.length) {
        await prisma.bookingAssignment.createMany({
          data: batch,
          skipDuplicates: true,
        });
      }

      // Optional: trailing Kirtan block at the end
      if ((pt.trailingKirtanMinutes ?? 0) > 0) {
        const ks = new Date(end.getTime() - pt.trailingKirtanMinutes! * 60_000);
        await prisma.bookingAssignment.createMany({
          data: orderedJ.map((s) => ({
            bookingId: booking.id,
            bookingItemId: item.id,
            staffId: s,
            start: ks,
            end,
          })),
          skipDuplicates: true,
        });
      }
      continue; // skip normal flow
    }

    const minK = Math.max(0, pt.minKirtanis ?? 0);
    const minP = Math.max(0, pt.minPathers ?? 0);
    const ppl = Math.max(pt.peopleRequired ?? 0, minK + minP);

    const tk = Math.max(0, pt.trailingKirtanMinutes ?? 0);
    const rot = Math.max(0, pt.pathRotationMinutes ?? 0);
    const closingDouble = Math.max(0, pt.pathClosingDoubleMinutes ?? 0);

    const kirtanStart = tk > 0 ? new Date(end.getTime() - tk * 60_000) : null;
    const pathEnd = kirtanStart ?? end;
    const pathStart = start;

    const reservedConcurrent = new Set<string>();

    // 1) KIRTAN
    if (minK > 0 && tk === 0) {
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
        picksK.forEach((id) => reservedConcurrent.add(id)); // avoid double-book with PATH
        await commit(item.id, picksK, start, end);
      }
    }

    if (tk > 0) {
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

    // 2) PATH
    if (minP > 0) {
      if (rot > 0) {
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

    // 3) FLEX (short slots only)
    const totalMinutes = Math.max(
      0,
      Math.round((end.getTime() - start.getTime()) / 60_000)
    );
    const isShort = totalMinutes <= 240; // <= 4h

    if (isShort && ppl > minK + minP && tk === 0 && minK > 0) {
      const already = await prisma.bookingAssignment.findMany({
        where: { bookingId: thisBookingId, bookingItemId: item.id },
        select: { staffId: true },
      });
      const have = new Set(already.map((a) => a.staffId));
      const want = Math.max(0, ppl - have.size);

      if (want > 0) {
        const pathOnly = await availablePathOnly(start, end);
        const pathOnlyOrdered = await orderByWeightedLoad(
          exclude(
            pathOnly.map((s) => s.id),
            have
          ),
          'PATH'
        );

        let flexPool = [...pathOnlyOrdered];

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
