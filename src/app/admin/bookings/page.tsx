// src/app/admin/bookings/page.tsx
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { format } from 'date-fns';
import { ApproveButtons } from './parts';

function fmt(d: Date) {
  try {
    return format(d, 'EEE, MMM d yyyy, h:mm a');
  } catch {
    return d.toString();
  }
}

export default async function AdminBookingsPage() {
  const session = await auth();
  const role = (session?.user as any)?.role ?? null;
  const isAdmin = role === 'ADMIN';
  if (!isAdmin) {
    return (
      <div className='p-6'>
        <h1 className='text-lg font-semibold'>Admin · Bookings</h1>
        <p className='mt-2 text-sm text-gray-600'>
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const [pending, recentConfirmed] = await Promise.all([
    prisma.booking.findMany({
      where: { status: 'PENDING' },
      orderBy: { start: 'asc' },
      include: {
        hall: true,
        items: { include: { programType: true } },
      },
    }),
    prisma.booking.findMany({
      where: { status: 'CONFIRMED' },
      orderBy: { start: 'desc' },
      take: 20,
      include: {
        hall: true,
        items: { include: { programType: true } },
      },
    }),
  ]);

  return (
    <div className='p-6 space-y-8'>
      <h1 className='text-lg font-semibold'>Admin · Bookings</h1>

      <section>
        <h2 className='font-semibold mb-3'>Pending approvals</h2>
        {pending.length === 0 ? (
          <div className='text-sm text-gray-600'>No pending bookings.</div>
        ) : (
          <div className='divide-y rounded-xl border'>
            {pending.map((b) => (
              <div
                key={b.id}
                className='p-4 flex flex-col md:flex-row md:items-center gap-3'
              >
                <div className='flex-1'>
                  <div className='font-medium'>{b.title}</div>
                  <div className='text-sm text-gray-600'>
                    {fmt(b.start)} – {fmt(b.end)} · {b.locationType}
                    {b.hall?.name ? ` · ${b.hall.name}` : ''}
                    {b.address ? ` · ${b.address}` : ''}
                  </div>
                  <div className='text-xs text-gray-500 mt-1'>
                    Attendees: {b.attendees} · Contact: {b.contactName} (
                    {b.contactPhone}
                    {b.contactEmail ? `, ${b.contactEmail}` : ''})
                  </div>
                  <div className='text-xs text-gray-500 mt-1'>
                    Programs:{' '}
                    {b.items.map((i) => i.programType.name).join(', ')}
                  </div>
                </div>
                <div className='md:w-[240px]'>
                  <ApproveButtons id={b.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className='font-semibold mb-3'>Recently confirmed (latest 20)</h2>
        {recentConfirmed.length === 0 ? (
          <div className='text-sm text-gray-600'>
            No confirmed bookings yet.
          </div>
        ) : (
          <div className='divide-y rounded-xl border'>
            {recentConfirmed.map((b) => (
              <div key={b.id} className='p-4'>
                <div className='font-medium'>{b.title}</div>
                <div className='text-sm text-gray-600'>
                  {fmt(b.start)} – {fmt(b.end)} · {b.locationType}
                  {b.hall?.name ? ` · ${b.hall.name}` : ''}
                </div>
                <div className='text-xs text-gray-500 mt-1'>
                  Programs: {b.items.map((i) => i.programType.name).join(', ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
