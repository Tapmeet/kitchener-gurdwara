// src/app/api/staff/[id]/assignments.ics/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

function icsEscape(s: string) {
  return s.replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
}

function isAdminRole(role?: string | null) {
  return role === 'ADMIN';
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user || !isAdminRole((session.user as any).role)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const staff = await prisma.staff.findUnique({
    where: { id: id },
    select: { id: true, name: true },
  });
  if (!staff) return new NextResponse('Not found', { status: 404 });

  const now = new Date();
  const asgn = await prisma.bookingAssignment.findMany({
    where: {
      staffId: staff.id,
      booking: { status: 'CONFIRMED', end: { gte: now } },
    },
    include: {
      booking: { include: { hall: true } },
      bookingItem: { include: { programType: true } },
    },
    orderBy: [{ start: 'asc' }, { booking: { start: 'asc' } }],
  });

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Kitchener Gurdwara//Staff ${staff.name} Assignments//EN`,
  ];

  for (const a of asgn) {
    const b = a.booking;
    const it = a.bookingItem;
    const role =
      it.programType.category === 'PATH'
        ? 'Path'
        : it.programType.category === 'KIRTAN'
          ? 'Kirtan'
          : it.programType.category;
    const loc =
      b.locationType === 'GURDWARA'
        ? b.hall?.name
          ? `Gurdwara — ${b.hall.name}`
          : 'Gurdwara'
        : b.address
          ? `Outside — ${b.address}`
          : 'Outside';

    const uid = `asg-${a.id}@kitchener-gurdwara`;

    const sStart = a.start ?? b.start;
    const sEnd = a.end ?? b.end;
    const dtStart = sStart
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
    const dtEnd = sEnd
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${icsEscape(`${role} — ${it.programType.name} (${b.title})`)}`,
      `LOCATION:${icsEscape(loc)}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');

  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${staff.name.replace(/\s+/g, '_').toLowerCase()}_assignments.ics"`,
    },
  });
}
