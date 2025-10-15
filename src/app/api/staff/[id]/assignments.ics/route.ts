import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

function icsDate(d: Date) {
  // UTC in YYYYMMDDTHHmmssZ
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const staffId = params.id;
  const now = new Date();

  const rows = await prisma.bookingAssignment.findMany({
    where: {
      staffId,
      state: 'CONFIRMED',
      OR: [
        { end: { gte: now } },
        { AND: [{ end: null }, { booking: { end: { gte: now } } }] },
      ],
      booking: { status: 'CONFIRMED' },
    },
    include: {
      booking: true,
      bookingItem: { include: { programType: true } },
      staff: { select: { name: true } },
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

  for (const a of rows) {
    const b = a.booking;
    const it = a.bookingItem!;
    const start = a.start ?? b.start;
    const end = a.end ?? b.end;

    const uid = `${a.id}@kitchener-gurdwara`;
    const dtStart = icsDate(start);
    const dtEnd = icsDate(end);
    const summary = `${it.programType.name} — ${b.title}`;
    const location =
      b.locationType === 'GURDWARA'
        ? (b as any).hall?.name
          ? `Gurdwara — ${(b as any).hall?.name}`
          : 'Gurdwara'
        : (b.address ?? 'Outside');
    const desc = `Assigned to: ${a.staff?.name ?? ''}`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${summary.replace(/\n/g, ' ')}`,
      `LOCATION:${(location ?? '').replace(/\n/g, ' ')}`,
      `DESCRIPTION:${desc.replace(/\n/g, ' ')}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');

  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="assignments.ics"',
    },
  });
}
