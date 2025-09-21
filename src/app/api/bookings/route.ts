import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { CreateBookingSchema } from '@/lib/validation';
import { checkCaps } from '@/lib/conflicts';
// ⬇️ business hours helper
import { isWithinBusinessHours } from '@/lib/businessHours';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = CreateBookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // exactly one program (your original rule)
    if (input.items.length !== 1) {
      return NextResponse.json(
        { error: 'Exactly one program must be selected.' },
        { status: 400 }
      );
    }

    // ⛔️ Do NOT force hallId from client anymore.
    // if (input.locationType === 'GURDWARA' && !input.hallId) { ... }  <-- removed

    if (input.locationType === 'OUTSIDE_GURDWARA' && !input.address?.trim()) {
      return NextResponse.json(
        { error: 'Address is required for outside bookings' },
        { status: 400 }
      );
    }

    // Business hours: support boolean or { ok, error }
    // AFTER (safe if end is optional)
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

    // Load the referenced program type(s)
    const ptIds = input.items.map((i) => i.programTypeId);
    const pts = await prisma.programType.findMany({
      where: { id: { in: ptIds } },
    });
    if (pts.length !== ptIds.length) {
      return NextResponse.json(
        { error: 'Invalid program types' },
        { status: 400 }
      );
    }

    // Overlapping bookings (same as before)
    const overlapping = await prisma.booking.findMany({
      where: { start: { lt: end }, end: { gt: start } },
      include: { items: { include: { programType: true } } },
    });

    const cap = checkCaps(overlapping as unknown as any, pts as unknown as any);
    if (!cap.ok) {
      return NextResponse.json({ error: cap.error }, { status: 409 });
    }

    // Hall concurrency limit (you kept this as a global cap of 2)
    if (input.locationType === 'GURDWARA') {
      const HALL_CAP = 2;
      const concurrentHalls = await prisma.booking.count({
        where: {
          locationType: 'GURDWARA',
          start: { lt: end },
          end: { gt: start },
        },
      });
      if (concurrentHalls >= HALL_CAP) {
        return NextResponse.json(
          { error: 'Both halls are occupied at that time.' },
          { status: 409 }
        );
      }
    }

    // ✅ AUTO-ASSIGN HALL on server (users cannot choose on client)
    let hallId: string | null = null;
    if (input.locationType === 'GURDWARA') {
      const halls = await prisma.hall.findMany({ where: { isActive: true } });

      // Try capacity first if present; otherwise match by name
      const attendees =
        typeof input.attendees === 'number' ? Math.max(1, input.attendees) : 1;

      const smallHall =
        halls.find((h) => (h as any).capacity && (h as any).capacity <= 125) ||
        halls.find((h) => /small/i.test(h.name));
      const mainHall =
        halls.find((h) => (h as any).capacity && (h as any).capacity > 125) ||
        halls.find((h) => /main/i.test(h.name));

      const pick =
        attendees < 125
          ? smallHall ?? mainHall ?? null
          : mainHall ?? smallHall ?? null;

      if (!pick) {
        return NextResponse.json(
          { error: 'No suitable hall is available for the attendee count.' },
          { status: 409 }
        );
      }
      hallId = pick.id;
    }

    const booking = await prisma.booking.create({
      data: {
        title: input.title,
        start,
        end,
        locationType: input.locationType,
        hallId, // <-- auto-chosen or null for outside
        address:
          input.locationType === 'OUTSIDE_GURDWARA'
            ? input.address ?? null
            : null,
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        notes: input.notes ?? null,
        attendees:
          typeof input.attendees === 'number'
            ? Math.max(1, input.attendees)
            : 1,
        items: {
          create: input.items.map((i) => ({ programTypeId: i.programTypeId })),
        },
      },
    });

    return NextResponse.json({ id: booking.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
