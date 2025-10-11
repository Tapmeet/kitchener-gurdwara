import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (role !== 'ADMIN') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  await prisma.booking.update({
    where: { id: params.id },
    data: { status: 'CANCELLED' },
  });
  return NextResponse.json({ ok: true });
}
