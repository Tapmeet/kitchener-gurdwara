// src/app/api/bookings/[id]/confirm/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { autoAssignForBooking } from '@/lib/auto-assign';
import { notifyAssignmentsStaff } from '@/lib/assignment-notify-staff';
import {
  sendEmail,
  sendSms,
  renderBookingEmailCustomerConfirmed,
  renderBookingTextConfirmed,
} from '@/lib/notify';
import { VENUE_TZ } from '@/lib/businessHours';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function toLocalParts(input: Date | string | number) {
  const d = input instanceof Date ? input : new Date(input);
  const date = d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: VENUE_TZ,
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: VENUE_TZ,
  });
  return { date, time };
}

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

  // 1) Mark booking confirmed (and stamp approver)
  const updated = await prisma.booking.update({
    where: { id },
    data: { status: 'CONFIRMED', approvedAt: new Date(), ...approvedByData },
    include: {
      hall: { select: { name: true } },
    },
  });

  // 2) Optional: run auto-assign to fill any gaps
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
    // keep confirmation successful
  }

  // 3) Finalize all remaining PROPOSED assignments for this booking
  await prisma.bookingAssignment.updateMany({
    where: { bookingId: updated.id, state: 'PROPOSED' },
    data: { state: 'CONFIRMED' },
  });

  // 4) Notify customer that their booking is CONFIRMED
  try {
    const customerEmail = updated.contactEmail;
    const customerPhone = updated.contactPhone;

    if (customerEmail || customerPhone) {
      const { date: startDate, time: startTime } = toLocalParts(updated.start);
      const { time: endTime } = toLocalParts(updated.end);

      const customerHtml = renderBookingEmailCustomerConfirmed({
        title: updated.title,
        date: startDate,
        startLocal: startTime,
        endLocal: endTime,
        locationType: updated.locationType as 'GURDWARA' | 'OUTSIDE_GURDWARA',
        hallName: updated.hall?.name ?? null,
        address: updated.address,
      });

      const smsText = renderBookingTextConfirmed({
        title: updated.title,
        date: startDate,
        startLocal: startTime,
        endLocal: endTime,
        locationType: updated.locationType as 'GURDWARA' | 'OUTSIDE_GURDWARA',
        hallName: updated.hall?.name ?? null,
        address: updated.address,
      });

      await Promise.allSettled([
        customerEmail
          ? sendEmail({
              to: customerEmail,
              subject: `Booking confirmed – ${updated.title}`,
              html: customerHtml,
            })
          : Promise.resolve(),
        customerPhone
          ? sendSms({ toE164: customerPhone, text: smsText })
          : Promise.resolve(),
      ]);
    }
  } catch (e) {
    console.error('Customer confirm notification failed:', e);
    // do not fail the confirm API just because email/SMS failed
  }

  return NextResponse.json(
    { ok: true, id: updated.id, createdCount },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
