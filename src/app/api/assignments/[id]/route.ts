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
  const body = await req.json();
  const staffId = body?.staffId as string | undefined;
  if (!staffId)
    return NextResponse.json({ error: 'Missing staffId' }, { status: 400 });

  const updated = await prisma.bookingAssignment.update({
    where: { id: params.id },
    data: { staffId },
    include: { booking: true },
  });

  return NextResponse.json({ ok: true, bookingId: updated.bookingId });
}
