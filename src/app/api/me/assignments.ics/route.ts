// src/app/api/me/assignments.ics/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

function icsEscape(s: string) {
  return s.replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
}
function icsDate(d: Date) {
  // UTC, e.g. 20251015T113000Z
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return new NextResponse('Unauthorized', { status: 401 });

  // resolve the staff record for the logged-in user
  let staff: { id: string; name: string } | null = null;
  if (session.user.email) {
    staff = await prisma.staff.findFirst({
      where: { email: { equals: session.user.email, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
  }
  if (!staff) {
    staff = await prisma.staff.findFirst({
      where: { name: { equals: 'Granthi', mode: 'insensitive' } },
      select: { id: true, name: true },
    });
  }
  if (!staff) return new NextResponse('No staff', { status: 404 });

  const now = new Date();

  const asgn = await prisma.bookingAssignment.findMany({
    where: {
      staffId: staff.id,
      state: 'CONFIRMED',
      booking: { status: 'CONFIRMED' },
      // future only (handles windowed + unwindowed)
      OR: [
        { end: { gte: now } },
        { AND: [{ end: null }, { booking: { end: { gte: now } } }] },
      ],
    },
    include: {
      booking: { include: { hall: true } }, // << include hall so b.hall is typed
      bookingItem: { include: { programType: true } },
    },
    orderBy: [{ start: 'asc' }, { booking: { start: 'asc' } }],
  });

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kitchener Gurdwara//Assignments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
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

    const start = a.start ?? b.start;
    const end = a.end ?? b.end;

    lines.push(
      'BEGIN:VEVENT',
      `UID:asg-${a.id}@kitchener-gurdwara`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(`${role} — ${it.programType.name} (${b.title})`)}`,
      `LOCATION:${icsEscape(loc)}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');

  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="my-assignments.ics"',
    },
  });
}
