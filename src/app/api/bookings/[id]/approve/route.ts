import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // ← Promise
) {
  const { id } = await ctx.params; // ← await

  await prisma.$transaction([
    prisma.bookingAssignment.updateMany({
      where: { bookingId: id, state: 'PROPOSED' },
      data: { state: 'CONFIRMED' },
    }),
    prisma.booking.update({
      where: { id },
      data: { status: 'CONFIRMED', approvedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
