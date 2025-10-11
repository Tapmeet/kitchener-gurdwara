// src/app/api/bookings/[id]/cancel/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // <-- async params
) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { id } = await ctx.params; // <-- await it

  const updated = await prisma.booking.update({
    where: { id },
    data: { status: 'CANCELLED' },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: updated.id });
}
