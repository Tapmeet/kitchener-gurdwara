// src/app/api/housekeeping/expire-pending/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const expired = await prisma.booking.updateMany({
    where: { status: 'PENDING', createdAt: { lt: cutoff } },
    data: { status: 'EXPIRED' },
  });
  return NextResponse.json({ ok: true, expired: expired.count });
}

export async function GET() {
  return POST();
}
