// src/app/api/housekeeping/expire-pending/route.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Keep as string to avoid TS BigInt literal requirement
const LOCK_KEY = '581234567890123456';

// Optional: protect the endpoint so only Vercel Cron can call it
function checkAuth(req: NextRequest) {
  const s = process.env.CRON_SECRET;
  if (!s) return true; // allow locally if not set
  return req.headers.get('authorization') === `Bearer ${s}`;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return POST();
}

export async function POST() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Single-statement CTE:
  //  1) try to take a transaction-scoped advisory lock
  //  2) if acquired, run the UPDATE
  //  3) return both "locked" and "expired" in one round-trip
  const rows = await prisma.$queryRaw<{ locked: boolean; expired: number }[]>`
    WITH try_lock AS (
      SELECT pg_try_advisory_xact_lock(${LOCK_KEY}::bigint) AS locked
    ),
    do_update AS (
      UPDATE "Booking"
      SET "status" = CAST('EXPIRED' AS "BookingStatus")
      WHERE (SELECT locked FROM try_lock)
        AND "status" = CAST('PENDING' AS "BookingStatus")
        AND "createdAt" < ${cutoff}
      RETURNING 1
    )
    SELECT
      (SELECT locked FROM try_lock) AS locked,
      (SELECT COUNT(*)::int FROM do_update) AS expired;
  `;

  const locked = rows[0]?.locked === true;
  const expired = rows[0]?.expired ?? 0;

  // Return 200 on lock contention so Vercel Cron shows "success"
  if (!locked) {
    return NextResponse.json({ ok: true, locked: true, expired: 0 });
  }
  return NextResponse.json({ ok: true, locked: false, expired });
}
