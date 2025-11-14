// src/app/api/admin/bookings/[id]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { VENUE_TZ, isWithinBusinessHours } from '@/lib/businessHours';
import { sendEmail, renderBookingEmailCustomer } from '@/lib/notify';

// env gating – reuse same semantics as creation route
const VERCEL_ENV = process.env.VERCEL_ENV;
const NODE_ENV = process.env.NODE_ENV;
const isProdEnv =
  VERCEL_ENV === 'production' || (!VERCEL_ENV && NODE_ENV === 'production');
const bookingNotificationsEnabled =
  process.env.BOOKING_NOTIFICATIONS_ENABLED !== '0';
const shouldSendBookingNotifications = isProdEnv && bookingNotificationsEnabled;

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

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;

    const session = await auth();
    const role = (session?.user as any)?.role;
    if (role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Get current booking (including hall for email + previous times)
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        hall: { select: { name: true } },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const prevStart = booking.start;
    const prevEnd = booking.end;

    const {
      title,
      start,
      end,
      attendees,
      contactName,
      contactPhone,
      contactEmail,
      notes,
    } = body || {};

    const newTitle =
      typeof title === 'string' && title.trim() ? title.trim() : booking.title;

    const newStart = start ? new Date(start) : booking.start;
    const newEnd = end ? new Date(end) : booking.end;

    // Business-hours guard (same semantics as create, non-long bookings)
    const bh = isWithinBusinessHours(newStart, newEnd, VENUE_TZ);
    if (!bh.ok) {
      return NextResponse.json(
        { error: bh.error ?? 'Outside business hours' },
        { status: 400 }
      );
    }

    const newAttendees =
      typeof attendees === 'number' && !Number.isNaN(attendees)
        ? Math.max(1, attendees)
        : booking.attendees;

    const newContactName =
      typeof contactName === 'string' && contactName.trim()
        ? contactName.trim()
        : booking.contactName;

    const newContactPhone =
      typeof contactPhone === 'string' && contactPhone.trim()
        ? contactPhone.trim()
        : booking.contactPhone;

    let newContactEmail: string | null;
    if (contactEmail === null) {
      newContactEmail = null;
    } else if (typeof contactEmail === 'string') {
      const trimmed = contactEmail.trim();
      newContactEmail = trimmed || null;
    } else {
      newContactEmail = booking.contactEmail;
    }

    const newNotes = typeof notes === 'string' ? notes : booking.notes;

    // Compute shift delta (how much we move everything by)
    const deltaMs = newStart.getTime() - prevStart.getTime();
    const durationChanged = newEnd.getTime() - prevEnd.getTime() !== deltaMs;

    const updated = await prisma.$transaction(async (tx) => {
      // 1) Update booking
      const updatedBooking = await tx.booking.update({
        where: { id },
        data: {
          title: newTitle,
          start: newStart,
          end: newEnd,
          attendees: newAttendees,
          contactName: newContactName,
          contactPhone: newContactPhone,
          contactEmail: newContactEmail,
          notes: newNotes,
        },
        include: {
          hall: { select: { name: true } },
        },
      });

      // 2) Shift assignment windows so sevadars/jathas follow the new time
      //    We keep it simple: apply the same delta to each assignment's start/end.
      if (deltaMs !== 0) {
        const assignments = await tx.bookingAssignment.findMany({
          where: { bookingId: id },
          select: { id: true, start: true, end: true },
        });

        for (const a of assignments) {
          const oldStart = a.start ?? prevStart;
          const oldEnd = a.end ?? prevEnd;

          // Use the same shift for start and end.
          // If the duration changed, we still shift as-is (keeps relative offsets).
          const shiftedStart = new Date(oldStart.getTime() + deltaMs);
          const shiftedEnd = new Date(oldEnd.getTime() + deltaMs);

          await tx.bookingAssignment.update({
            where: { id: a.id },
            data: {
              start: shiftedStart,
              end: shiftedEnd,
            },
          });
        }

        console.log('[admin bookings PATCH] Shifted assignments by', {
          bookingId: id,
          deltaMs,
          hours: deltaMs / 3_600_000,
          durationChanged,
        });
      }

      return updatedBooking;
    });

    // Notify customer about change (prod only)
    if (shouldSendBookingNotifications && updated.contactEmail) {
      const { date: startDate, time: startTime } = toLocalParts(updated.start);
      const { time: endTime } = toLocalParts(updated.end);

      const customerHtml = renderBookingEmailCustomer({
        bookingId: updated.id,
        title: updated.title,
        date: startDate,
        startLocal: startTime,
        endLocal: endTime,
        locationType: updated.locationType,
        hallName: updated.hall?.name ?? null,
        address: updated.address,
        attendees: updated.attendees,
      });

      await sendEmail({
        to: updated.contactEmail,
        subject: 'Your booking was updated',
        html: customerHtml,
      });
    } else {
      console.log('[admin bookings PATCH] Skipping customer email', {
        shouldSendBookingNotifications,
        hasEmail: !!updated.contactEmail,
      });
    }

    return NextResponse.json(
      {
        id: updated.id,
        ok: true,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error('Admin booking update error', e);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
