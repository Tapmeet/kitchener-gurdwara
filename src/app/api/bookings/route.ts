import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { CreateBookingSchema } from '@/lib/validation';
import {
  isWithinBusinessHours,
  hourSpan,
  BUSINESS_HOURS_24,
} from '@/lib/businessHours';
import { add, reqFromProgram, RoleVector, ROLES } from '@/lib/roles';
import { getMaxPerLocationPerRole, getTotalPoolPerRole } from '@/lib/pools';

import {
  sendEmail,
  renderBookingEmailAdmin,
  renderBookingEmailCustomer,
  sendSms,
  getAdminEmails,
  renderBookingText,
} from '@/lib/notify';
import { auth } from '@/lib/auth';
import { autoAssignForBooking } from '@/lib/auto-assign';
import { notifyAssignmentsStaff } from '@/lib/assignment-notify-staff';

const OUTSIDE_BUFFER_MS = 15 * 60 * 1000;

function toLocalParts(input: Date | string | number) {
  const d = input instanceof Date ? input : new Date(input);
  const date = d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return { date, time };
}

type CreatedBooking = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hallId: string | null;
  address: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  notes: string | null;
  attendees: number;
  hall: { name: string } | null;
};

export async function POST(req: Request) {
  try {
    let session: any | null = null;
    try {
      session = await auth();
    } catch {
      session = null;
    }

    const body = await req.json();
    const parsed = CreateBookingSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    const input = parsed.data;

    if (input.locationType === 'OUTSIDE_GURDWARA' && !input.address?.trim()) {
      return NextResponse.json(
        { error: 'Address is required for outside bookings' },
        { status: 400 }
      );
    }

    const start = new Date(input.start);
    const end = new Date(input.end ?? input.start);
    const bh = isWithinBusinessHours(start, end) as
      | boolean
      | { ok: boolean; error?: string };
    const bhOk = typeof bh === 'boolean' ? bh : bh.ok;
    if (!bhOk) {
      const reason =
        typeof bh === 'object' && 'error' in bh && bh.error
          ? bh.error
          : 'Outside business hours';
      return NextResponse.json({ error: reason }, { status: 400 });
    }

    const ptIds = (input.items || []).map((i: any) => i.programTypeId);
    if (!ptIds.length)
      return NextResponse.json(
        { error: 'At least one program must be selected.' },
        { status: 400 }
      );
    const programs = await prisma.programType.findMany({
      where: { id: { in: ptIds } },
      select: {
        id: true,
        minPathers: true,
        minKirtanis: true,
        canBeOutsideGurdwara: true,
        requiresHall: true,
      },
    });
    if (programs.length !== ptIds.length)
      return NextResponse.json(
        { error: 'Invalid program types' },
        { status: 400 }
      );

    if (
      input.locationType === 'OUTSIDE_GURDWARA' &&
      programs.some((p) => !p.canBeOutsideGurdwara)
    ) {
      return NextResponse.json(
        { error: 'One or more programs cannot be performed outside.' },
        { status: 400 }
      );
    }

    const required: RoleVector = programs.reduce(
      (acc, p) => add(acc, reqFromProgram(p)),
      { PATH: 0, KIRTAN: 0 }
    );

    if (input.locationType === 'GURDWARA') {
      const HALL_CAP = 2;
      const concurrentHalls = await prisma.booking.count({
        where: {
          locationType: 'GURDWARA',
          start: { lt: end },
          end: { gt: start },
        },
      });
      if (concurrentHalls >= HALL_CAP)
        return NextResponse.json(
          { error: 'Both halls are occupied at that time.' },
          { status: 409 }
        );
    }

    let hallId: string | null = null;
    if (input.locationType === 'GURDWARA') {
      const halls = await prisma.hall.findMany({ where: { isActive: true } });
      const attendees =
        typeof input.attendees === 'number' ? Math.max(1, input.attendees) : 1;
      const smallHall =
        halls.find((h: any) => h.capacity && h.capacity <= 125) ||
        halls.find((h) => /small/i.test(h.name));
      const mainHall =
        halls.find((h: any) => h.capacity && h.capacity > 125) ||
        halls.find((h) => /main/i.test(h.name));
      const pick =
        attendees < 125
          ? (smallHall ?? mainHall ?? null)
          : (mainHall ?? smallHall ?? null);
      if (!pick)
        return NextResponse.json(
          { error: 'No suitable hall is available for the attendee count.' },
          { status: 409 }
        );
      hallId = pick.id;
    }

    const candStart =
      input.locationType === 'OUTSIDE_GURDWARA'
        ? new Date(start.getTime() - OUTSIDE_BUFFER_MS)
        : start;
    const candEnd =
      input.locationType === 'OUTSIDE_GURDWARA'
        ? new Date(end.getTime() + OUTSIDE_BUFFER_MS)
        : end;

    const hours = hourSpan(candStart, candEnd).filter((h) =>
      BUSINESS_HOURS_24.includes(h)
    );
    if (!hours.length)
      return NextResponse.json(
        { error: 'Selected time is outside business hours.' },
        { status: 400 }
      );

    const created: CreatedBooking = await prisma.$transaction(async (tx) => {
      const overlaps = await tx.booking.findMany({
        where: { start: { lte: candEnd }, end: { gte: candStart } },
        include: {
          items: {
            include: {
              programType: { select: { minPathers: true, minKirtanis: true } },
            },
          },
        },
      });

      const usedGW: Record<number, RoleVector> = {};
      const usedOUT: Record<number, RoleVector> = {};
      for (const h of BUSINESS_HOURS_24) {
        usedGW[h] = { PATH: 0, KIRTAN: 0 };
        usedOUT[h] = { PATH: 0, KIRTAN: 0 };
      }

      for (const b of overlaps) {
        const vec = b.items.reduce(
          (acc, it: any) => add(acc, reqFromProgram(it.programType as any)),
          { PATH: 0, KIRTAN: 0 }
        );
        const s = new Date(b.start);
        const e = new Date(b.end);
        const paddedStart =
          b.locationType === 'OUTSIDE_GURDWARA'
            ? new Date(s.getTime() - OUTSIDE_BUFFER_MS)
            : s;
        const paddedEnd =
          b.locationType === 'OUTSIDE_GURDWARA'
            ? new Date(e.getTime() + OUTSIDE_BUFFER_MS)
            : e;
        const hrs = hourSpan(paddedStart, paddedEnd).filter((h) =>
          BUSINESS_HOURS_24.includes(h)
        );
        for (const h of hrs) {
          if (b.locationType === 'GURDWARA') {
            usedGW[h].PATH += vec.PATH ?? 0;
            usedGW[h].KIRTAN += vec.KIRTAN ?? 0;
          } else {
            usedOUT[h].PATH += vec.PATH ?? 0;
            usedOUT[h].KIRTAN += vec.KIRTAN ?? 0;
          }
        }
      }

      const totalPool = await getTotalPoolPerRole();
      const locMax = getMaxPerLocationPerRole(input.locationType);

      for (const h of hours) {
        for (const r of ROLES as ReadonlyArray<keyof RoleVector>) {
          const total = totalPool[r] ?? 0;
          const usedOpp =
            input.locationType === 'GURDWARA'
              ? (usedOUT[h][r] ?? 0)
              : (usedGW[h][r] ?? 0);
          const usedHere =
            input.locationType === 'GURDWARA'
              ? (usedGW[h][r] ?? 0)
              : (usedOUT[h][r] ?? 0);
          const sharedLimit = Math.max(0, total - usedOpp);
          const locLimit = Math.min(
            sharedLimit,
            locMax[r] ?? Number.MAX_SAFE_INTEGER
          );
          const remaining = Math.max(0, locLimit - usedHere);
          const need = (required[r] ?? 0) as number;
          if (remaining < need) throw new Error('CAPACITY_EXCEEDED');
        }
      }

      const createdRaw = await tx.booking.create({
        data: {
          title: input.title,
          start,
          end,
          locationType: input.locationType,
          hallId,
          address:
            input.locationType === 'OUTSIDE_GURDWARA'
              ? (input.address ?? null)
              : null,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail ?? null,
          notes: input.notes ?? null,
          attendees:
            typeof input.attendees === 'number'
              ? Math.max(1, input.attendees)
              : 1,
          createdById: session?.user?.id ?? null,
          items: {
            create: input.items.map((i: any) => ({
              programTypeId: i.programTypeId,
            })),
          },
        },
        include: { hall: { select: { name: true } } },
      });

      const normalized: CreatedBooking = {
        id: createdRaw.id,
        title: createdRaw.title,
        start: createdRaw.start,
        end: createdRaw.end,
        locationType: createdRaw.locationType as CreatedBooking['locationType'],
        hallId: createdRaw.hallId,
        address: createdRaw.address,
        contactName: createdRaw.contactName,
        contactPhone: createdRaw.contactPhone,
        contactEmail: createdRaw.contactEmail,
        notes: createdRaw.notes,
        attendees: createdRaw.attendees,
        hall: createdRaw.hall ? { name: createdRaw.hall.name } : null,
      };
      return normalized;
    });

    // Auto-assign + staff notify (best-effort)
    if (process.env.AUTO_ASSIGN_ENABLED === '1') {
      try {
        const res = await autoAssignForBooking(created.id);
        if (res?.created?.length && process.env.ASSIGN_NOTIFICATIONS === '1') {
          await notifyAssignmentsStaff(
            created.id,
            res.created.map((a) => ({
              staffId: a.staffId,
              bookingItemId: a.bookingItemId,
            }))
          );
        }
      } catch (e) {
        console.error('Auto-assign or notify failed', e);
      }
    }

    const { date: startDate, time: startTime } = toLocalParts(created.start);
    const { time: endTime } = toLocalParts(created.end);

    const adminHtml = renderBookingEmailAdmin({
      title: created.title,
      date: startDate,
      startLocal: startTime,
      endLocal: endTime,
      locationType: created.locationType,
      hallName: created.hall?.name ?? null,
      address: created.address,
      contactName: created.contactName,
      contactPhone: created.contactPhone,
      attendees: created.attendees,
    });

    const customerHtml = renderBookingEmailCustomer({
      title: created.title,
      date: startDate,
      startLocal: startTime,
      endLocal: endTime,
      locationType: created.locationType,
      hallName: created.hall?.name ?? null,
      address: created.address,
    });

    const smsText = renderBookingText({
      title: created.title,
      date: startDate,
      startLocal: startTime,
      endLocal: endTime,
      locationType: created.locationType,
      hallName: created.hall?.name ?? null,
      address: created.address,
    });

    const adminRecipients = getAdminEmails();
    const customerEmail = (parsed.data as any).contactEmail as string | null;

    await Promise.allSettled([
      adminRecipients.length
        ? sendEmail({
            to: adminRecipients,
            subject: 'New Path/Kirtan Booking',
            html: adminHtml,
          })
        : Promise.resolve(),
      customerEmail
        ? sendEmail({
            to: customerEmail,
            subject: 'Your booking was received',
            html: customerHtml,
          })
        : Promise.resolve(),
      created.contactPhone
        ? sendSms({ toE164: created.contactPhone, text: smsText })
        : Promise.resolve(),
    ]);

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (e: any) {
    if (String(e?.message) === 'CAPACITY_EXCEEDED')
      return NextResponse.json(
        {
          error:
            'Not enough sevadars available for one or more roles at the selected time.',
        },
        { status: 409 }
      );
    console.error('Booking create error', e);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
