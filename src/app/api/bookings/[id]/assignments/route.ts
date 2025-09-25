// src/app/api/bookings/[id]/assignments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

type Params = { id: string };

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<Params> }
) {
  const { id } = await ctx.params;

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
