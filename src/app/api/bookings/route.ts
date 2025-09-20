import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { CreateBookingSchema } from '@/lib/validation';
import { checkCaps } from '@/lib/conflicts';

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

    // Single program guard (since UI enforces one function)
    if (input.items.length !== 1) {
      return NextResponse.json(
        { error: 'Exactly one program must be selected.' },
        { status: 400 }
      );
    }

    // Hall/Home invariants
    if (input.locationType === 'HALL' && !input.hallId) {
      return NextResponse.json(
        { error: 'Hall is required for hall bookings' },
        { status: 400 }
      );
    }
    if (input.locationType === 'HOME' && !input.address) {
      return NextResponse.json(
        { error: 'Address is required for home bookings' },
        { status: 400 }
      );
    }

    // Load selected program & check capacity overlap
    const ptIds = input.items.map((i) => i.programTypeId);
    const pts = await prisma.programType.findMany({
      where: { id: { in: ptIds } },
    });

    const overlapping = await prisma.booking.findMany({
      where: {
        start: { lt: new Date(input.end) },
        end: { gt: new Date(input.start) },
      },
      include: { items: { include: { programType: true } } },
    });
    const cap = checkCaps(overlapping as any, pts as any);
    if (!cap.ok)
      return NextResponse.json({ error: cap.error }, { status: 409 });

    // Optional hall capacity: ensure at most 2 hall bookings in that time
    if (input.locationType === 'HALL') {
      const HALL_CAP = 2;
      const concurrentHalls = await prisma.booking.count({
        where: {
          locationType: 'HALL',
          start: { lt: new Date(input.end) },
          end: { gt: new Date(input.start) },
        },
      });
      if (concurrentHalls >= HALL_CAP) {
        return NextResponse.json(
          { error: 'Both halls are occupied at that time.' },
          { status: 409 }
        );
      }
    }

    // Coerce numbers for lat/lng if provided
    const lat = input.address_lat ? Number(input.address_lat) : null;
    const lng = input.address_lng ? Number(input.address_lng) : null;

    const booking = await prisma.booking.create({
      data: {
        title: input.title,
        start: new Date(input.start),
        end: new Date(input.end),

        locationType: input.locationType as any,
        hallId: input.hallId ?? null,

        // freeform full address line
        address: input.address ?? null,

        // structured address
        addressCity: input.address_city ?? null,
        addressProvince: input.address_province ?? null,
        addressCountry: input.address_country ?? null,
        addressPostal: input.address_postal ?? null,
        addressLat: lat ?? undefined,
        addressLng: lng ?? undefined,

        contactName: input.contactName,
        contactPhone: input.contactPhone,
        notes: input.notes ?? null,

        items: {
          create: input.items.map((i) => ({ programTypeId: i.programTypeId })),
        },
      },
    });

    return NextResponse.json({ id: booking.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}
