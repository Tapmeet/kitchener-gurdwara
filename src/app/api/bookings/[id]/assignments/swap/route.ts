// src/app/api/bookings/[id]/assignments/swap/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/db';
import { StaffSkill } from '@/generated/prisma/client';;

const ALLOWED = new Set(['ADMIN']);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await ctx.params;

  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session?.user || !ALLOWED.has(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { bookingItemId, fromStaffId, toStaffId } = await req.json();
  if (
    !bookingItemId ||
    !fromStaffId ||
    !toStaffId ||
    fromStaffId === toStaffId
  ) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  // Load booking window (for overlap checks)
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, start: true, end: true },
  });
  if (!booking)
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // Ensure the "from" assignment exists on this item
  const existing = await prisma.bookingAssignment.findFirst({
    where: { bookingId, bookingItemId, staffId: fromStaffId },
    select: { id: true },
  });
  if (!existing)
    return NextResponse.json(
      { error: 'Original assignment not found' },
      { status: 404 }
    );

  // Prevent duplicate assignment of the same staff for this item
  const dupe = await prisma.bookingAssignment.findFirst({
    where: { bookingId, bookingItemId, staffId: toStaffId },
    select: { id: true },
  });
  if (dupe)
    return NextResponse.json(
      { error: 'Target staff already assigned to this item' },
      { status: 400 }
    );

  // Target staff must be active and free during this window
  const toStaff = await prisma.staff.findUnique({
    where: { id: toStaffId },
    select: { id: true, isActive: true, skills: true },
  });
  if (!toStaff?.isActive) {
    return NextResponse.json(
      { error: 'Target staff is not active' },
      { status: 400 }
    );
  }

  const conflict = await prisma.bookingAssignment.findFirst({
    where: {
      staffId: toStaffId,
      booking: { start: { lt: booking.end }, end: { gt: booking.start } }, // overlap
    },
    select: { id: true },
  });
  if (conflict)
    return NextResponse.json(
      { error: 'Target staff is busy in this time window' },
      { status: 409 }
    );

  // --- NEW: skill feasibility guard ---
  // Ensure swapping does not violate programType minimum skills (PATH/KIRTAN).
  const item = await prisma.bookingItem.findUnique({
    where: { id: bookingItemId },
    select: {
      bookingId: true,
      programType: {
        select: { minPathers: true, minKirtanis: true },
      },
    },
  });
  if (!item || item.bookingId !== bookingId) {
    return NextResponse.json(
      { error: 'Booking item does not belong to this booking' },
      { status: 400 }
    );
  }

  const currentAssignments = await prisma.bookingAssignment.findMany({
    where: { bookingItemId },
    include: { staff: { select: { skills: true, id: true } } },
  });

  // Recompute skills after the swap (remove "from", add "to")
  const updatedSkillSets: StaffSkill[][] = [
    ...currentAssignments
      .filter((a) => a.staffId !== fromStaffId)
      .map((a) => a.staff.skills),
    toStaff.skills,
  ];

  const pathers = updatedSkillSets.filter((s) =>
    s.includes(StaffSkill.PATH)
  ).length;
  const kirtanis = updatedSkillSets.filter((s) =>
    s.includes(StaffSkill.KIRTAN)
  ).length;

  const { minPathers, minKirtanis } = item.programType;
  if (pathers < minPathers || kirtanis < minKirtanis) {
    return NextResponse.json(
      {
        error:
          'Swap would violate minimum skill requirements for this program (PATH/KIRTAN).',
      },
      { status: 422 }
    );
  }
  // --- end skill guard ---

  // Do the swap. Updating is simpler than delete+create and respects unique constraints.
  try {
    await prisma.bookingAssignment.update({
      where: { id: existing.id },
      data: { staffId: toStaffId },
    });
  } catch (e: any) {
    // P2002 unique constraint (race): someone assigned toStaff meanwhile
    return NextResponse.json(
      { error: 'Another assignment occurred concurrently. Please retry.' },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
