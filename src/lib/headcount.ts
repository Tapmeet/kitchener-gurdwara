/** src/lib/headcount.ts
 * Helper to compute total unique active staff for headcount limits.
 */
import { prisma } from '@/lib/db';

/** Total unique active staff (any skill). Used for headcount limits. */
export async function getTotalUniqueStaffCount() {
  return prisma.staff.count({ where: { isActive: true } });
}
