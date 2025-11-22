// src/lib/jatha.ts
import { prisma } from '@/lib/db';
import { StaffSkill } from '@/generated/prisma/client';

export const JATHA_SIZE = 3;

/** Load jathas that actually have >= 3 active members with KIRTAN skill. */
export async function getJathaGroups() {
  const staff = await prisma.staff.findMany({
    where: {
      isActive: true,
      jatha: { not: null },
      skills: { has: StaffSkill.KIRTAN },
    },
    select: { id: true, name: true, jatha: true },
  });

  const groups = new Map<string, { id: string; name: string }[]>();
  for (const s of staff) {
    const key = String(s.jatha);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ id: s.id, name: s.name });
  }

  // keep only full jathas (>= 3 members)
  for (const [k, members] of [...groups.entries()]) {
    if (members.length < JATHA_SIZE) groups.delete(k);
  }
  return groups; // Map<"A"|"B"|..., [{id,name}...]>
}

/** Count how many full jathas exist. */
export async function getTotalJathaCount() {
  const groups = await getJathaGroups();
  return groups.size;
}

/** Return ids of all jatha members (for any jatha) */
export async function getAllJathaMemberIds() {
  const groups = await getJathaGroups();
  return [...groups.values()].flat().map((m) => m.id);
}
