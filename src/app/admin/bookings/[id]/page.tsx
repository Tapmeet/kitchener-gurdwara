// src/app/admin/bookings/[id]/page.tsx

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import Link from 'next/link';
import { redirect } from 'next/navigation';

function isPriv(role?: string | null) {
  return role === 'ADMIN';
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();

  const role = (session?.user as any)?.role ?? null;
  if (!session?.user || !isPriv(role)) {
    redirect(`/login?callbackUrl=/admin/bookings/${id}`);
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
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

  if (!booking) {
    return (
      <div className='mx-auto'>
        <div className='rounded-lg border border-amber-200 bg-amber-50 text-amber-900 p-4'>
          <p className='font-medium'>This booking no longer exists.</p>
          <p className='text-sm mt-1'>
            It may have been cleared as part of daily test resets or deleted.
          </p>
        </div>
        <div className='mt-4'>
          <Link
            href='/admin/bookings'
            className='inline-flex items-center rounded-md px-4 py-2 font-medium text-white transition relative overflow-hidden border border-white/15 bg-gradient-to-b from-blue-900/80 to-blue-900/60 backdrop-blur hover:from-blue-800/80 hover:to-blue-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40'
          >
            ← Back to Bookings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className='mx-auto'>
      <h1 className='text-xl font-semibold mb-4'>Booking Details</h1>
      <div className='rounded-xl border p-4 bg-white space-y-2'>
        <p>
          <b>Title:</b> {booking.title}
        </p>
        <p>
          <b>Status:</b>{' '}
          <span
            className={
              booking.status === 'CONFIRMED'
                ? 'inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800'
                : 'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
            }
          >
            {booking.status}
          </span>
        </p>
        <p>
          <b>When:</b> {new Date(booking.start).toLocaleString()} —{' '}
          {new Date(booking.end).toLocaleString()}
        </p>
        <p>
          <b>Location:</b>{' '}
          {booking.locationType === 'GURDWARA'
            ? booking.hall?.name || 'Gurdwara'
            : booking.address || 'Outside'}
        </p>
      </div>
      <div className='mt-4'>
        <Link
          href='/admin/bookings'
          className='text-sm text-blue-600 underline hover:text-blue-700'
        >
          Back to list
        </Link>
      </div>
    </div>
  );
}
