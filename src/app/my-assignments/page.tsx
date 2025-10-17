// src/app/my-assignments/page.tsx
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { fmtInVenue, DATE_TIME_FMT } from '@/lib/time';

function fmt(d: Date | string | number, pattern = DATE_TIME_FMT) {
  try {
    return fmtInVenue(d, pattern);
  } catch {
    const date = d instanceof Date ? d : new Date(d as any);
    return date.toString();
  }
}

export default async function MyAssignmentsPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <div className='p-6'>
        Please{' '}
        <Link href='/login' className='underline'>
          log in
        </Link>{' '}
        to view your schedule.
      </div>
    );
  }

  const email = session.user.email?.toLowerCase();
  if (!email) return <div className='p-6'>Your account has no email.</div>;

  const staff = await prisma.staff.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!staff) {
    return (
      <div className='p-6'>
        No Staff profile linked to <b>{email}</b>. Ask an admin to set{' '}
        <code>staff.email</code>.
      </div>
    );
  }

  const now = new Date();
  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      staffId: staff.id,
      state: 'CONFIRMED',
      OR: [
        { end: { gte: now } }, // windowed assignments
        { AND: [{ end: null }, { booking: { end: { gte: now } } }] }, // legacy
      ],
      booking: { status: 'CONFIRMED' },
    },
    include: {
      booking: { include: { hall: true } },
      bookingItem: { include: { programType: true } },
    },
    orderBy: [{ start: 'asc' }, { booking: { start: 'asc' } }],
  });

  if (!assignments.length)
    return <div className='p-6'>No upcoming assignments.</div>;

  return (
    <div className='p-6 space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-xl font-semibold'>My Assignments</h1>
        <a
          href={`/api/staff/${staff.id}/assignments.ics`}
          className='text-sm underline hover:no-underline'
        >
          Subscribe (ICS)
        </a>
      </div>

      <ul className='space-y-3'>
        {assignments.map((a) => {
          const b = a.booking;
          const it = a.bookingItem!;
          const sStart = a.start ?? b.start;
          const sEnd = a.end ?? b.end;
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

          return (
            <li key={a.id} className='rounded-xl border p-4'>
              <div className='text-base font-medium'>{b.title}</div>
              <div className='text-sm text-gray-600'>
                {fmt(sStart)} – {fmt(sEnd)}
              </div>
              <div className='text-sm'>{loc}</div>
              <div className='mt-1 text-sm'>
                <b>{role}</b> — {it.programType.name}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
