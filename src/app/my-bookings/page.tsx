// src/app/my-bookings/page.tsx
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { fmtInVenue, DATE_TIME_FMT } from '@/lib/time';
import { Prisma } from '@prisma/client';

function fmt(d: Date | string | number, pattern = DATE_TIME_FMT) {
  try {
    return fmtInVenue(d, pattern);
  } catch {
    const date = d instanceof Date ? d : new Date(d as any);
    return date.toString();
  }
}

export default async function MyBookingsPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <div className='p-6'>
        Please{' '}
        <Link href='/login' className='underline'>
          log in
        </Link>{' '}
        to view your bookings.
      </div>
    );
  }

  const email = session.user.email ?? null;
  const userId = (session.user as any)?.id ?? null;

  // Properly typed OR filters (avoids union-widening TS errors)
  const orFilters: Prisma.BookingWhereInput[] = [];
  if (userId) {
    orFilters.push({ createdById: userId as string });
  }
  if (email) {
    orFilters.push({
      contactEmail: {
        equals: email,
        mode: Prisma.QueryMode.insensitive,
      },
    });
  }

  const bookings = await prisma.booking.findMany({
    where: orFilters.length ? { OR: orFilters } : {},
    include: {
      hall: true,
      items: { include: { programType: true } },
    },
    orderBy: { start: 'desc' },
  });

  if (bookings.length === 0) {
    return (
      <div className='p-6'>
        <h1 className='text-xl font-semibold'>My Bookings</h1>
        <p className='text-sm text-gray-600 mt-2'>
          You don’t have any bookings yet.{' '}
          <Link href='/book' className='underline'>
            Make a booking
          </Link>
          .
        </p>
      </div>
    );
  }

  // Classification uses absolute time; formatting uses venue TZ
  const now = new Date();
  const isLive = (status: string) => !['CANCELLED', 'EXPIRED'].includes(status);

  const inProgress = bookings
    .filter((b) => isLive(b.status) && b.start <= now && b.end > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const upcoming = bookings
    .filter((b) => isLive(b.status) && b.start > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const completed = bookings
    .filter((b) => b.end <= now)
    .sort((a, b) => b.end.getTime() - a.end.getTime());

  const Section = ({
    title,
    rows,
  }: {
    title: string;
    rows: typeof bookings;
  }) => (
    <section className='mt-6'>
      <h2 className='font-semibold mb-3'>{title}</h2>
      {rows.length === 0 ? (
        <div className='text-sm text-gray-500'>Nothing here.</div>
      ) : (
        <div className='divide-y rounded-xl border bg-white'>
          {rows.map((b) => {
            const programs = b.items
              .map((i) => i.programType?.name)
              .filter(Boolean)
              .join(', ');
            const where =
              b.locationType === 'GURDWARA'
                ? b.hall?.name
                  ? `Gurdwara — ${b.hall.name}`
                  : 'Gurdwara'
                : b.address
                  ? `Outside — ${b.address}`
                  : 'Outside';

            return (
              <div key={b.id} className='p-4 flex flex-col gap-1'>
                <div className='flex items-center justify-between gap-3'>
                  <Link
                    href={`/bookings/${b.id}`}
                    className='font-medium underline decoration-dotted underline-offset-2'
                  >
                    {b.title}
                  </Link>
                  <span className='text-xs px-2 py-0.5 rounded-full border'>
                    {b.status}
                  </span>
                </div>
                <div className='text-sm text-gray-700'>
                  {fmt(b.start)} – {fmt(b.end)} · {where}
                </div>
                <div className='text-xs text-gray-500'>
                  Programs: {programs || '—'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <div className='p-6 space-y-6'>
      <h1 className='text-xl font-semibold'>My Bookings</h1>
      <Section title='In progress' rows={inProgress} />
      <Section title='Upcoming' rows={upcoming} />
      <Section title='Completed' rows={completed} />
    </div>
  );
}
