//src/app/api/bookings/[id]/proposed-assignments/route.ts

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { busyStaffIds } from '@/lib/fairness';

const isAdmin = (r?: string | null) => r === 'ADMIN';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // 👈 params is a Promise
) {
  const { id } = await ctx.params; // 👈 await it

  const session = await auth();
  if (!session?.user || !isAdmin((session.user as any).role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      assignments: {
        where: { state: 'PROPOSED' },
        include: {
          staff: {
            select: { id: true, name: true, jatha: true, skills: true },
          },
          bookingItem: { include: { programType: true } },
          booking: true,
        },
        orderBy: [{ start: 'asc' }, { booking: { start: 'asc' } }],
      },
    },
  });
  if (!booking)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const allStaff = await prisma.staff.findMany({
    where: { isActive: true },
    select: { id: true, name: true, jatha: true, skills: true },
    orderBy: [{ jatha: 'asc' }, { name: 'asc' }],
  });

  const out = [];
  for (const a of booking.assignments) {
    const sStart = a.start ?? a.booking.start;
    const sEnd = a.end ?? a.booking.end;
    const busy = await busyStaffIds(sStart, sEnd);

    const candidates = allStaff
      .filter((s) => !busy.has(s.id) || s.id === a.staffId)
      .map((s) => ({
        id: s.id,
        name: s.name,
        jatha: s.jatha,
        skills: s.skills,
      }));

    out.push({
      id: a.id,
      program: a.bookingItem.programType.name,
      roleCategory: a.bookingItem.programType.category,
      start: sStart,
      end: sEnd,
      currentStaff: {
        id: a.staff.id,
        name: a.staff.name,
        jatha: a.staff.jatha,
        skills: a.staff.skills,
      },
      candidates,
    });
  }

  return NextResponse.json(
    { bookingId: booking.id, assignments: out },
    {
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
