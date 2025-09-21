import { prisma } from './db';
import type { RoleVector } from './roles';

export async function getTotalPoolPerRole(): Promise<RoleVector> {
  const staff = await prisma.staff.findMany({ where: { isActive: true }, select: { skills: true } });
  let PATH = 0, KIRTAN = 0;
  for (const s of staff) {
    if (s.skills.includes('PATH')) PATH++;
    if (s.skills.includes('KIRTAN')) KIRTAN++;
  }
  return { PATH, KIRTAN };
}

export function getMaxPerLocationPerRole(_location: 'GURDWARA' | 'OUTSIDE_GURDWARA'): RoleVector {
  return { PATH: Number.MAX_SAFE_INTEGER, KIRTAN: Number.MAX_SAFE_INTEGER };
}
