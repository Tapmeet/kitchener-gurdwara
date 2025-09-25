import { NextRequest, NextResponse, URLPattern } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  // Read :id from the URL instead of using the 2nd arg
  const pattern = new URLPattern({ pathname: '/api/bookings/:id/assignments' });
  const match = pattern.exec(req.nextUrl);
  const id = match?.pathname.groups.id;

  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  try {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            programType: true,
            assignments: { include: { staff: true } },
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    return NextResponse.json(booking);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unexpected error' },
      { status: 500 }
    );
  }
}