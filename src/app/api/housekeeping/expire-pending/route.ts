// src/app/api/housekeeping/expire-pending/route.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs'; // Prisma needs Node runtime
export const dynamic = 'force-dynamic'; // ensure not statically cached

// Any 64-bit key; single-arg TX lock (NOT the (bigint,bigint) overload)
const LOCK_KEY = '581234567890123456';

/** Optional: lock down to Vercel Cron by CRON_SECRET (see step 3). */
function checkAuth(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // allow locally if not set
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return POST(); // reuse POST logic
}

export async function POST() {
  // Do everything inside a transaction so the xact-lock is auto-released
  const result = await prisma.$transaction(async (tx) => {
    // Acquire a transaction-level advisory lock (fast fail)
    const rows = await tx.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${LOCK_KEY}::bigint) AS acquired
    `;
    const acquired = rows[0]?.acquired === true;

    if (!acquired) {
      // IMPORTANT: return 200 so Vercel doesn’t mark the run as "failed"
      return { ok: true, locked: true, expired: 0 };
    }

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const res = await tx.booking.updateMany({
      where: { status: 'PENDING', createdAt: { lt: cutoff } },
      data: { status: 'EXPIRED' },
    });

    return { ok: true, locked: false, expired: res.count };
  });

  return NextResponse.json(result);
}
