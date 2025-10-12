// src/app/my-assignments/page.tsx
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { format } from 'date-fns';

function fmt(d: Date) {
  try {
    return format(d, 'EEE, MMM d yyyy, h:mm a');
  } catch {
    return d.toString();
  }
}

export default async function MyAssignmentsPage() {
  const session = await auth();
  if (!session) {
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

  if (!session?.user) {
    return <div className='p-6'>Please sign in to view your assignments.</div>;
  }

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

  if (!staff) {
    return (
      <div className='p-6'>
        No matching staff found
        {session.user.email ? (
          <>
            {' '}
            for <b>{session.user.email}</b>
          </>
        ) : (
          ''
        )}
        .<br />
        Ask an admin to link your account to a Staff record or set Staff.email.
      </div>
    );
  }

  const now = new Date();
  const assignments = await prisma.bookingAssignment.findMany({
    where: { staffId: staff.id, booking: { end: { gte: now } } },
    include: {
      booking: { include: { hall: true } },
      bookingItem: { include: { programType: true } },
    },
    orderBy: [{ booking: { start: 'asc' } }],
  });

  if (!assignments.length) {
    return <div className='p-6'>No upcoming assignments.</div>;
  }

  return (
    <div className='p-6 space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-xl font-semibold'>My Assignments</h1>
        <a
          href='/api/me/assignments.ics'
          className='text-sm underline hover:no-underline'
        >
          Subscribe (ICS)
        </a>
      </div>

      <ul className='space-y-3'>
        {assignments.map((a) => {
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

          return (
            <li key={a.id} className='rounded-xl border p-4'>
              <div className='text-base font-medium'>{b.title}</div>
              <div className='text-sm text-gray-600'>
                {fmt(b.start)} – {fmt(b.end)}
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
