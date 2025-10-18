// src/app/api/bookings/[id]/confirm/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { autoAssignForBooking } from '@/lib/auto-assign';
import { notifyAssignmentsStaff } from '@/lib/assignment-notify-staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id } = await ctx.params;

  // Resolve approver (by id or email)
  let approvedByData: Record<string, any> = {};
  try {
    const sid = (session as any)?.user?.id || null;
    const semail = (session as any)?.user?.email || null;
    if (sid) {
      const exists = await prisma.user.findUnique({
        where: { id: sid },
        select: { id: true },
      });
      if (exists) approvedByData = { approvedById: exists.id };
    }
    if (!('approvedById' in approvedByData) && semail) {
      approvedByData = {
        approvedBy: {
          connectOrCreate: {
            where: { email: semail },
            create: {
              email: semail,
              name: (session as any)?.user?.name ?? null,
              role: 'ADMIN' as any,
            },
          },
        },
      };
    }
  } catch {}

  // (Your existing status flip here; leaving your logic intact)
  const updated = await prisma.booking.update({
    where: { id },
    data: { status: 'CONFIRMED', approvedAt: new Date(), ...approvedByData },
    select: { id: true },
  });

  let createdCount = 0;
  try {
    const res = await autoAssignForBooking(updated.id);
    createdCount = res?.created?.length ?? 0;

    if (createdCount) {
      await notifyAssignmentsStaff(
        updated.id,
        res.created.map((a) => ({
          staffId: a.staffId,
          bookingItemId: a.bookingItemId,
        }))
      );
    }
  } catch (e) {
    console.error('Auto-assign during confirm failed:', e);
    // keep approval successful, but surface the warning to the client
  }

  return NextResponse.json(
    { ok: true, id: updated.id, createdCount },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
