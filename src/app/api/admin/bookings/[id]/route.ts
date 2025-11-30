// src/app/api/admin/bookings/[id]/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { VENUE_TZ, isWithinBusinessHours } from '@/lib/businessHours';
import { sendEmail, renderBookingEmailCustomer } from '@/lib/notify';
import { autoAssignForBooking } from '@/lib/auto-assign';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        hall: { select: { name: true } },
        items: { select: { id: true, programTypeId: true } },
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
      hallId,
      locationType,
      address,
      programTypeIds,
    } = body || {};

    const newTitle =
      typeof title === 'string' && title.trim() ? title.trim() : booking.title;

    const newStart = start ? new Date(start) : booking.start;
    const newEnd = end ? new Date(end) : booking.end;

    // Business-hours guard (same semantics as create)
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
    // Location type – allow switching between Gurdwara / outside
    let newLocationType = booking.locationType;
    if (locationType === 'GURDWARA' || locationType === 'OUTSIDE_GURDWARA') {
      newLocationType = locationType;
    }

    // Hall logic depends on location type
    let newHallId: string | null = booking.hallId;

    if (newLocationType === 'GURDWARA') {
      if (hallId === null) {
        newHallId = null;
      } else if (typeof hallId === 'string') {
        const trimmed = hallId.trim();
        newHallId = trimmed || null;
      }
    } else {
      // Outside Gurdwara: never keep a hall
      newHallId = null;
    }

    // Address logic – only for outside bookings
    let newAddress: string | null = booking.address;

    if (newLocationType === 'OUTSIDE_GURDWARA') {
      if (address === null) {
        newAddress = null;
      } else if (typeof address === 'string') {
        const trimmed = address.trim();
        newAddress = trimmed || null;
      }
    } else {
      // Gurdwara bookings store no address
      newAddress = null;
    }

    // Program type changes (optional)
    const currentProgramTypeIds = booking.items
      .map((i) => i.programTypeId)
      .sort();

    const incomingProgramTypeIds = Array.isArray(programTypeIds)
      ? (programTypeIds as string[])
          .map((x) => String(x).trim())
          .filter(Boolean)
          .sort()
      : null;

    const programsChanged =
      incomingProgramTypeIds !== null &&
      JSON.stringify(incomingProgramTypeIds) !==
        JSON.stringify(currentProgramTypeIds);

    // Time shift
    const deltaMs = newStart.getTime() - prevStart.getTime();

    const updated = await prisma.$transaction(async (tx) => {
      // 1) Update main booking
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
          locationType: newLocationType,
          hallId: newHallId,
          address: newAddress,
          ...(programsChanged
            ? {
                status: 'PENDING',
                approvedAt: null,
                approvedById: null,
              }
            : {}),
        },
        include: {
          hall: { select: { name: true } },
        },
      });

      // 2) If program set changed, replace booking items & clear all assignments
      if (programsChanged && incomingProgramTypeIds) {
        await tx.bookingAssignment.deleteMany({
          where: { bookingId: id },
        });

        await tx.bookingItem.deleteMany({
          where: { bookingId: id },
        });

        if (incomingProgramTypeIds.length) {
          await tx.bookingItem.createMany({
            data: incomingProgramTypeIds.map((ptId) => ({
              bookingId: id,
              programTypeId: ptId,
            })),
            skipDuplicates: true,
          });
        }

        console.log(
          '[admin bookings PATCH] Program types changed; reset to PENDING and cleared assignments',
          {
            bookingId: id,
            programTypeIds: incomingProgramTypeIds,
          }
        );
      } else if (deltaMs !== 0) {
        // 3) If only the time changed, shift all assignment windows by the same delta
        const assignments = await tx.bookingAssignment.findMany({
          where: { bookingId: id },
          select: { id: true, start: true, end: true },
        });

        for (const a of assignments) {
          const oldStart = a.start ?? prevStart;
          const oldEnd = a.end ?? prevEnd;

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
        });
      }

      return updatedBooking;
    });

    // 4) If program set changed, re-run auto-assign to create new PROPOSED rows
    if (programsChanged) {
      try {
        const res = await autoAssignForBooking(id);
        console.log(
          '[admin bookings PATCH] Re-auto-assigned after program change',
          {
            bookingId: id,
            createdCount: res?.created?.length ?? 0,
          }
        );
      } catch (e) {
        console.error(
          '[admin bookings PATCH] autoAssignForBooking failed after program change',
          e
        );
      }
    }

    // 5) Notify customer about change (prod only)
    if (shouldSendBookingNotifications && updated.contactEmail) {
      try {
        const { date: startDate, time: startTime } = toLocalParts(
          updated.start
        );
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
      } catch (e) {
        console.error('[admin bookings PATCH] Customer update email failed', e);
      }
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
