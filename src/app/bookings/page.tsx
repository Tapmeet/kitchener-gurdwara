// src/app/bookings/page.tsx
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

function fmt(d: Date) {
  try {
    return format(d, 'EEE, MMM d yyyy, h:mm a');
  } catch {
    return d.toString();
  }
}

export default async function BookingsIndexPage() {
  const bookings = await prisma.booking.findMany({
    where: { status: 'CONFIRMED' },
    orderBy: { start: 'desc' },
    take: 50,
    include: {
      hall: true,
      items: { include: { programType: true } },
      assignments: {
        include: {
          staff: true,
          bookingItem: { include: { programType: true } },
        },
      },
    },
  });

  return (
    <div className='p-6 space-y-6'>
      <h1 className='text-lg font-semibold'>Bookings</h1>

      {bookings.length === 0 ? (
        <div className='text-sm text-gray-600'>No confirmed bookings yet.</div>
      ) : (
        <div className='divide-y rounded-xl border bg-white/50'>
          {bookings.map((b) => (
            <div key={b.id} className='p-4'>
              <div className='flex items-center justify-between'>
                <div className='font-medium'>
                  {fmt(b.start)} – {fmt(b.end)} · {b.locationType}
                  {b.hall?.name ? ` · ${b.hall.name}` : ''}
                </div>
                <Link
                  href={`/bookings/${b.id}/assignments`}
                  className='text-sm underline'
                >
                  View assignments
                </Link>
              </div>
              <div className='text-xs text-gray-500 mt-1'>
                Programs: {b.items.map((i) => i.programType.name).join(', ')}
              </div>
              {!!b.assignments.length && (
                <div className='text-xs text-gray-700 mt-2'>
                  Staff:{' '}
                  {b.assignments
                    .map((a) => a.staff?.name)
                    .filter(Boolean)
                    .join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
