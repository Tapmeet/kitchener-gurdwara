import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { autoAssignForBooking } from '@/lib/auto-assign';
import { notifyAssignmentsStaff } from '@/lib/assignment-notify-staff';
// import { checkStaffCapacity } from '@/lib/staff-capacity'; // (optional) remove if unused

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  try {
    const res = await autoAssignForBooking(id);
    if (res?.created?.length && process.env.ASSIGN_NOTIFICATIONS === '1') {
      await notifyAssignmentsStaff(
        id,
        res.created.map((a) => ({
          staffId: a.staffId,
          bookingItemId: a.bookingItemId,
        }))
      );
    }
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    console.error('Manual auto-assign failed', e);
    return NextResponse.json({ error: 'Auto-assign failed' }, { status: 500 });
  }
}
