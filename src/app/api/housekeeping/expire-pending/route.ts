// src/app/api/housekeeping/expire-pending/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Use a 2-int advisory lock key to avoid BigInt quirks in JS
const LOCK_KEY_A = 424242;
const LOCK_KEY_B = 777;

async function doWork() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Try to acquire the lock so only one run executes at a time
  const res = await prisma.$queryRaw<{ pg_try_advisory_lock: boolean }[]>`
    SELECT pg_try_advisory_lock(${LOCK_KEY_A}, ${LOCK_KEY_B})
  `;
  const gotLock = res?.[0]?.pg_try_advisory_lock === true;

  if (!gotLock) {
    return {
      ok: true,
      skipped: true,
      reason: 'Another run is in progress',
      expired: 0,
    };
  }

  try {
    const expired = await prisma.booking.updateMany({
      where: { status: 'PENDING', createdAt: { lt: cutoff } },
      data: { status: 'EXPIRED' },
    });
    return { ok: true, expired: expired.count };
  } finally {
    // Always release the lock
    await prisma.$executeRaw`
      SELECT pg_advisory_unlock(${LOCK_KEY_A}, ${LOCK_KEY_B})
    `;
  }
}

export async function POST() {
  try {
    const result = await doWork();
    return NextResponse.json(result);
  } catch (e: any) {
    // Handle Prisma pool exhaustion gracefully
    if (e?.code === 'P2024') {
      return NextResponse.json(
        { ok: false, expired: 0, error: 'DB pool exhausted (P2024)' },
        { status: 503 }
      );
    }
    throw e;
  }
}

export async function GET() {
  return POST();
}
