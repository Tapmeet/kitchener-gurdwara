import { PrismaClient, Staff, StaffSkill, LocationType } from '@prisma/client';
import { bufferedWindow, overlaps } from './scheduling';

export type Requirement = {
  bookingId: string;
  bookingItemId: string;
  locationType: LocationType;
  start: Date;
  end: Date;
  peopleRequired: number;
  minPathers: number;
  minKirtanis: number;
};

export async function allocateStaffForItems(
  prisma: PrismaClient,
  reqs: Requirement[]
): Promise<{ ok: true; assignments: Array<{bookingItemId: string; staffId: string}> } | { ok: false; reason: string }> {
  const staff: Staff[] = await prisma.staff.findMany({ where: { isActive: true } });

  const existing = await prisma.bookingAssignment.findMany({
    include: {
      booking: true,
      staff: true,
      bookingItem: { include: { programType: true } },
    },
  });

  function isFree(s: Staff, win: {start: Date; end: Date}) {
    for (const a of existing) {
      if (a.staffId !== s.id) continue;
      const aw = bufferedWindow(a.booking.start, a.booking.end, a.booking.locationType);
      if (overlaps(win, aw)) return false;
    }
    return true;
  }

  const staffBySkill = {
    PATH: staff.filter(s => s.skills.includes(StaffSkill.PATH)),
    KIRTAN: staff.filter(s => s.skills.includes(StaffSkill.KIRTAN)),
  };

  const result: Array<{bookingItemId: string; staffId: string}> = [];

  for (const req of reqs) {
    const win = bufferedWindow(req.start, req.end, req.locationType);

    const chosen: Staff[] = [];

    const kirtCandidates = staffBySkill.KIRTAN.filter(s => isFree(s, win) && !chosen.some(c => c.id === s.id));
    if (kirtCandidates.length < req.minKirtanis) {
      return { ok: false, reason: `Not enough Kirtanis available for booking item ${req.bookingItemId}` };
    }
    chosen.push(...kirtCandidates.slice(0, req.minKirtanis));

    const pathCandidates = staffBySkill.PATH.filter(s => isFree(s, win) && !chosen.some(c => c.id === s.id));
    if (pathCandidates.length < req.minPathers) {
      return { ok: false, reason: `Not enough Path sevadars available for booking item ${req.bookingItemId}` };
    }
    chosen.push(...pathCandidates.slice(0, req.minPathers));

    const remaining = req.peopleRequired - chosen.length;
    if (remaining > 0) {
      const anyAvail = staff
        .filter(s => isFree(s, win) && !chosen.some(c => c.id === s.id))
        .sort((a, b) => b.skills.length - a.skills.length);

      if (anyAvail.length < remaining) {
        return { ok: false, reason: `Not enough total staff available for booking item ${req.bookingItemId}` };
      }
      chosen.push(...anyAvail.slice(0, remaining));
    }

    for (const s of chosen) {
      result.push({ bookingItemId: req.bookingItemId, staffId: s.id });
      existing.push({
        id: 'virtual',
        bookingId: req.bookingId,
        bookingItemId: req.bookingItemId,
        staffId: s.id,
        booking: {
          id: req.bookingId,
          start: req.start,
          end: req.end,
          locationType: req.locationType,
        } as any,
        staff: s,
        bookingItem: {} as any,
        createdAt: new Date(),
      } as any);
    }
  }

  return { ok: true, assignments: result };
}