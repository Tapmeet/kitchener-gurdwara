// src/app/api/assignments/swap/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

const isAdmin = (r?: string | null) => r === 'ADMIN';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !isAdmin((session.user as any).role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const bookingId = String(body?.bookingId || '').trim();
  const aId = String(body?.a || '').trim();
  const bId = String(body?.b || '').trim();

  if (!bookingId || !aId || !bId || aId === bId) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const [A, B] = await Promise.all([
    prisma.bookingAssignment.findUnique({
      where: { id: aId },
      include: { booking: true, bookingItem: true },
    }),
    prisma.bookingAssignment.findUnique({
      where: { id: bId },
      include: { booking: true, bookingItem: true },
    }),
  ]);

  if (!A || !B)
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    );
  if (A.bookingId !== bookingId || B.bookingId !== bookingId) {
    return NextResponse.json(
      { error: 'Assignments are not from this booking' },
      { status: 400 }
    );
  }
  if (A.state !== 'PROPOSED' || B.state !== 'PROPOSED') {
    return NextResponse.json(
      { error: 'Can only swap PROPOSED assignments' },
      { status: 400 }
    );
  }

  // if both are the exact same window & item, swapping staff in-place will hit
  // the unique constraint ([bookingItemId, staffId, start, end]). Use dropdown.
  const sameWindow =
    A.bookingItemId === B.bookingItemId &&
    (A.start?.getTime() ?? A.booking.start.getTime()) ===
      (B.start?.getTime() ?? B.booking.start.getTime()) &&
    (A.end?.getTime() ?? A.booking.end.getTime()) ===
      (B.end?.getTime() ?? B.booking.end.getTime());

  if (sameWindow) {
    return NextResponse.json(
      {
        error:
          'These rows are the same slot. Use the per-row dropdown to change staff.',
      },
      { status: 409 }
    );
  }

  // swap: safe when the time windows differ → no unique-key conflict
  await prisma.$transaction(async (tx) => {
    await tx.bookingAssignment.update({
      where: { id: A.id },
      data: { staffId: B.staffId },
    });
    await tx.bookingAssignment.update({
      where: { id: B.id },
      data: { staffId: A.staffId },
    });
  });

  return NextResponse.json({ ok: true });
}
