import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> } // ← Promise
) {
  const { id } = await ctx.params; // ← await
  const body = await req.json();
  const staffId = String(body?.staffId || '').trim();
  if (!staffId) {
    return NextResponse.json({ error: 'Missing staffId' }, { status: 400 });
  }

  const updated = await prisma.bookingAssignment.update({
    where: { id },
    data: { staffId },
    include: {
      staff: true,
      bookingItem: { include: { programType: true } },
    },
  });

  return NextResponse.json({ ok: true, updated });
}
