import { PrismaClient, StaffSkill } from '@/generated/prisma/client';;

export type StaffRequirement = {
  minPathers: number;
  minKirtanis: number;
  flex: number;
};

function addReq(a: StaffRequirement, b: StaffRequirement): StaffRequirement {
  return {
    minPathers: a.minPathers + b.minPathers,
    minKirtanis: a.minKirtanis + b.minKirtanis,
    flex: a.flex + b.flex,
  };
}

function reqFromProgramType(pt: {
  peopleRequired: number;
  minPathers: number;
  minKirtanis: number;
}): StaffRequirement {
  const flex = Math.max(
    0,
    (pt.peopleRequired ?? 0) - (pt.minPathers ?? 0) - (pt.minKirtanis ?? 0)
  );
  return {
    minPathers: pt.minPathers ?? 0,
    minKirtanis: pt.minKirtanis ?? 0,
    flex,
  };
}

export async function checkStaffCapacity(
  prisma: PrismaClient,
  start: Date,
  end: Date,
  extraProgramTypeIds: string[] = []
): Promise<boolean> {
  const overlappingItems = await prisma.bookingItem.findMany({
    where: { booking: { start: { lt: end }, end: { gt: start } } },
    include: {
      programType: {
        select: { peopleRequired: true, minPathers: true, minKirtanis: true },
      },
    },
  });

  let need: StaffRequirement = { minPathers: 0, minKirtanis: 0, flex: 0 };
  for (const it of overlappingItems)
    need = addReq(need, reqFromProgramType(it.programType));

  if (extraProgramTypeIds.length) {
    const pts = await prisma.programType.findMany({
      where: { id: { in: extraProgramTypeIds } },
      select: { peopleRequired: true, minPathers: true, minKirtanis: true },
    });
    for (const pt of pts) need = addReq(need, reqFromProgramType(pt));
  }

  const staff = await prisma.staff.findMany({
    where: { isActive: true },
    select: { skills: true },
  });

  let pathOnly = 0,
    kirtanOnly = 0,
    both = 0;
  for (const s of staff) {
    const hasP = s.skills.includes(StaffSkill.PATH);
    const hasK = s.skills.includes(StaffSkill.KIRTAN);
    if (hasP && hasK) both++;
    else if (hasP) pathOnly++;
    else if (hasK) kirtanOnly++;
  }

  const usePO = Math.min(pathOnly, need.minPathers);
  pathOnly -= usePO;
  need.minPathers -= usePO;
  const useBP = Math.min(both, need.minPathers);
  both -= useBP;
  need.minPathers -= useBP;

  const useKO = Math.min(kirtanOnly, need.minKirtanis);
  kirtanOnly -= useKO;
  need.minKirtanis -= useKO;
  const useBK = Math.min(both, need.minKirtanis);
  both -= useBK;
  need.minKirtanis -= useBK;

  if (need.minPathers > 0 || need.minKirtanis > 0) return false;
  const remaining = pathOnly + kirtanOnly + both;
  return need.flex <= remaining;
}
