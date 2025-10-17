// src/app/api/housekeeping/expire-pending/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const LOCK_KEY = '9223372036854775707'; // keep as string, cast to ::bigint in SQL

export async function POST() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Transaction-scoped advisory lock; auto-released at tx end.
      const rows = await tx.$queryRaw<{ ok: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${LOCK_KEY}::bigint) AS ok
      `;
      const ok = rows[0]?.ok === true;

      if (!ok) {
        // Somebody else is already running housekeeping
        return { locked: true, expired: 0 };
      }

      const expired = await tx.booking.updateMany({
        where: { status: 'PENDING', createdAt: { lt: cutoff } },
        data: { status: 'EXPIRED' },
      });

      return { locked: false, expired: expired.count };
    });

    // If locked, return 409 so callers can back off
    if (result.locked) {
      return NextResponse.json(
        { ok: true, locked: true, expired: 0 },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      locked: false,
      expired: result.expired,
    });
  } catch (err) {
    console.error('expire-pending failed', err);
    return NextResponse.json(
      { ok: false, error: 'Housekeeping failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return POST();
}

export const runtime = 'nodejs';
