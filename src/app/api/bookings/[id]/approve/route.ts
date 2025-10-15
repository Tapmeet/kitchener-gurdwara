import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

const isAdmin = (r?: string | null) => r === 'ADMIN';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // 👈
) {
  const { id } = await ctx.params; // 👈

  const session = await auth();
  if (!session?.user || !isAdmin((session.user as any).role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await prisma.$transaction([
    prisma.bookingAssignment.updateMany({
      where: { bookingId: id, state: 'PROPOSED' },
      data: { state: 'CONFIRMED' },
    }),
    prisma.booking.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        approvedAt: new Date(),
        approvedById: (session.user as any).id ?? null,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
