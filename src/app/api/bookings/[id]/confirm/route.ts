import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { autoAssignForBooking } from '@/lib/auto-assign';
import { notifyAssignmentsStaff } from '@/lib/assignment-notify-staff';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (role !== 'ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const id = params.id;

  const updated = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        approvedAt: new Date(),
        approvedById: (session?.user as any)?.id ?? null,
      },
      select: { id: true, start: true, end: true },
    });

    // Auto-assign now
    const res = await autoAssignForBooking(id);
    if (res.created.length) {
      await notifyAssignmentsStaff(
        id,
        res.created.map((a) => ({
          staffId: a.staffId,
          bookingItemId: a.bookingItemId,
        }))
      );
    }
    return booking;
  });

  return NextResponse.json({ ok: true, id: updated.id });
}
