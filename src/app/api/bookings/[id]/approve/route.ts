import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

function isAdmin(role?: string | null) {
  return role === 'ADMIN';
}

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user || !isAdmin((session.user as any).role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const booking = await prisma.booking.findUnique({ where: { id: params.id } });
  if (!booking)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.$transaction([
    prisma.bookingAssignment.updateMany({
      where: { bookingId: params.id, state: 'PROPOSED' },
      data: { state: 'CONFIRMED' },
    }),
    prisma.booking.update({
      where: { id: params.id },
      data: {
        status: 'CONFIRMED',
        approvedAt: new Date(),
        approvedById: (session.user as any).id ?? null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
