import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

function isAdmin(role?: string | null) {
  return role === 'ADMIN';
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user || !isAdmin((session.user as any).role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { staffId } = await req.json();
  if (!staffId)
    return NextResponse.json({ error: 'Missing staffId' }, { status: 400 });

  const a = await prisma.bookingAssignment.update({
    where: { id: params.id },
    data: { staffId },
    include: { booking: true },
  });

  if (a.booking.status !== 'PENDING') {
    return NextResponse.json({
      warning:
        'Booking already confirmed; change will affect confirmed schedule.',
    });
  }
  return NextResponse.json({ ok: true });
}
