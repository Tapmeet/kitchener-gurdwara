// src/app/api/bookings/[id]/assignments/swap/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/db';

const ALLOWED = new Set(['ADMIN', 'SECRETARY']);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await ctx.params;
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session?.user || !ALLOWED.has(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { bookingItemId, fromStaffId, toStaffId } = await req.json();
  if (
    !bookingItemId ||
    !fromStaffId ||
    !toStaffId ||
    fromStaffId === toStaffId
  ) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  // Load booking + times for conflict checks
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, start: true, end: true },
  });
  if (!booking)
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  // Ensure the "from" assignment exists
  const existing = await prisma.bookingAssignment.findFirst({
    where: { bookingId, bookingItemId, staffId: fromStaffId },
    select: { id: true },
  });
  if (!existing)
    return NextResponse.json(
      { error: 'Original assignment not found' },
      { status: 404 }
    );

  // Ensure "to" isn’t already assigned to this item
  const dupe = await prisma.bookingAssignment.findFirst({
    where: { bookingId, bookingItemId, staffId: toStaffId },
    select: { id: true },
  });
  if (dupe)
    return NextResponse.json(
      { error: 'Target staff already assigned to this item' },
      { status: 400 }
    );

  // Check conflicts for the target staff in the same time window
  const conflict = await prisma.bookingAssignment.findFirst({
    where: {
      staffId: toStaffId,
      booking: { start: { lt: booking.end }, end: { gt: booking.start } }, // overlap
    },
    select: { id: true },
  });
  if (conflict)
    return NextResponse.json(
      { error: 'Target staff is busy in this time window' },
      { status: 409 }
    );

  // Perform swap atomically: delete old, create new (or just update staffId)
  await prisma.$transaction([
    prisma.bookingAssignment.delete({ where: { id: existing.id } }),
    prisma.bookingAssignment.create({
      data: { bookingId, bookingItemId, staffId: toStaffId },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
