import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // ← Promise
) {
  const session = await auth();
  const role = (session as any)?.user?.role;
  if (role !== 'ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  const { id } = await ctx.params;

  // Resolve approver
  let approvedByData: Record<string, any> = {};
  try {
    const sid = (session as any)?.user?.id || null;
    const semail = (session as any)?.user?.email || null;
    if (sid) {
      const exists = await prisma.user.findUnique({
        where: { id: sid },
        select: { id: true },
      });
      if (exists) approvedByData = { approvedById: exists.id };
    }
    if (!('approvedById' in approvedByData) && semail) {
      approvedByData = {
        approvedBy: {
          connectOrCreate: {
            where: { email: semail },
            create: {
              email: semail,
              name: (session as any)?.user?.name ?? null,
              role: 'ADMIN' as any,
            },
          },
        },
      };
    }
  } catch {}

  await prisma.$transaction([
    prisma.bookingAssignment.updateMany({
      where: { bookingId: id, state: 'PROPOSED' },
      data: { state: 'CONFIRMED' },
    }),
    prisma.booking.update({
      where: { id },
      data: { status: 'CONFIRMED', approvedAt: new Date(), ...approvedByData },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
