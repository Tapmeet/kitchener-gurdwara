// src/app/api/bookings/[id]/confirm/route.ts

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { autoAssignForBooking } from '@/lib/auto-assign';
import { notifyAssignmentsStaff } from '@/lib/assignment-notify-staff';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // <-- params is a Promise
) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id } = await ctx.params; // <-- await it

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      status: 'CONFIRMED',
      approvedAt: new Date(),
      approvedById: (session?.user as any)?.id ?? null,
    },
    select: { id: true },
  });

  // Run auto-assign after status flips to CONFIRMED
  try {
    const res = await autoAssignForBooking(updated.id);
    if (res?.created?.length) {
      await notifyAssignmentsStaff(
        updated.id,
        res.created.map((a) => ({
          staffId: a.staffId,
          bookingItemId: a.bookingItemId,
        }))
      );
    }
  } catch (e) {
    console.error('Auto-assign in confirm failed', e);
  }

  return NextResponse.json({ ok: true, id: updated.id });
}
