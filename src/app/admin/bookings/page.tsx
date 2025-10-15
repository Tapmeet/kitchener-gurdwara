// src/app/admin/bookings/page.tsx
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { format } from 'date-fns';
import { ApproveButtons } from './parts';
import ReviewProposed from '@/components/admin/ReviewProposed';

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
        // 🔍 only show PROPOSED rows for pending bookings
        assignments: {
          where: { state: 'PROPOSED' },
          orderBy: [{ start: 'asc' }, { booking: { start: 'asc' } }],
          include: {
            staff: true,
            bookingItem: { include: { programType: true } },
          },
        },
      },
    }),
    prisma.booking.findMany({
      where: { status: 'CONFIRMED' },
      orderBy: { start: 'desc' },
      take: 20,
      include: {
        hall: true,
        items: { include: { programType: true } },
        // ✅ only show CONFIRMED rows on confirmed bookings
        assignments: {
          where: { state: 'CONFIRMED' },
          orderBy: [{ start: 'asc' }, { booking: { start: 'asc' } }],
          include: {
            staff: true,
            bookingItem: { include: { programType: true } },
          },
        },
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
            {pending.map((b) => {
              // Dedupe names so rotations don't repeat visually
              const uniqueNames = Array.from(
                new Set(
                  b.assignments
                    .map((a) => a.staff?.name)
                    .filter(Boolean) as string[]
                )
              );
              return (
                <div
                  key={b.id}
                  className='p-4 flex flex-col md:flex-row md:items-start gap-3'
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
                    {uniqueNames.length ? (
                      <div className='text-xs text-gray-700 mt-1'>
                        Staff: {uniqueNames.join(', ')}
                      </div>
                    ) : null}

                    {/* 👇 Add the swap UI here */}
                    <div className='mt-3'>
                      <ReviewProposed bookingId={b.id} showApprove={false} />
                    </div>
                  </div>

                  {/* Your existing Approve/Cancel buttons (Approve should POST /api/bookings/[id]/approve) */}
                  <div className='md:w-[240px] flex flex-col gap-2'>
                    <a
                      href={`/bookings/${b.id}/assignments`}
                      className='text-sm underline hover:no-underline'
                    >
                      Manage assignments
                    </a>
                    <ApproveButtons id={b.id} />
                  </div>
                </div>
              );
            })}
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
            {recentConfirmed.map((b) => {
              const uniqueNames = Array.from(
                new Set(
                  b.assignments
                    .map((a) => a.staff?.name)
                    .filter(Boolean) as string[]
                )
              );
              return (
                <div key={b.id} className='p-4'>
                  <div className='font-medium'>{b.title}</div>
                  <div className='text-sm text-gray-600'>
                    {fmt(b.start)} – {fmt(b.end)} · {b.locationType}
                    {b.hall?.name ? ` · ${b.hall.name}` : ''}
                  </div>
                  <div className='text-xs text-gray-500 mt-1'>
                    Programs:{' '}
                    {b.items.map((i) => i.programType.name).join(', ')}
                  </div>
                  {uniqueNames.length ? (
                    <div className='text-xs text-gray-700 mt-1'>
                      Staff: {uniqueNames.join(', ')}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
