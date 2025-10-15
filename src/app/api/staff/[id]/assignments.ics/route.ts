import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

function icsDate(d: Date) {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> } // 👈
) {
  const { id: staffId } = await ctx.params; // 👈

  const rows = await prisma.bookingAssignment.findMany({
    where: {
      staffId,
      state: 'CONFIRMED',
      booking: { status: 'CONFIRMED' },
    },
    include: {
      booking: true,
      bookingItem: { include: { programType: true } },
      staff: { select: { name: true } },
    },
    orderBy: [{ start: 'asc' }, { booking: { start: 'asc' } }],
  });

  const lines = [
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
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a.id}@kitchener-gurdwara`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${(it.programType.name + ' — ' + b.title).replace(/\n/g, ' ')}`,
      `LOCATION:${(b.locationType === 'GURDWARA' ? ((b as any).hall?.name ? 'Gurdwara — ' + (b as any).hall?.name : 'Gurdwara') : (b.address ?? 'Outside')).replace(/\n/g, ' ')}`,
      `DESCRIPTION:Assigned to ${a.staff?.name ?? ''}`,
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
