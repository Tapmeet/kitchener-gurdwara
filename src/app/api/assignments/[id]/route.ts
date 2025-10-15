import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

const isAdmin = (r?: string | null) => r === 'ADMIN';

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> } // 👈
) {
  const { id } = await ctx.params; // 👈

  const session = await auth();
  if (!session?.user || !isAdmin((session.user as any).role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { staffId } = await req.json();
  if (!staffId)
    return NextResponse.json({ error: 'Missing staffId' }, { status: 400 });

  const updated = await prisma.bookingAssignment.update({
    where: { id },
    data: { staffId },
    select: { id: true, bookingId: true, staffId: true },
  });

  return NextResponse.json({ ok: true, ...updated });
}
