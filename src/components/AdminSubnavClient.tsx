// src/components/AdminSubnavClient.tsx
'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';

export default function AdminSubnavClient() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  if (role !== 'ADMIN') return null;

  return (
    <nav className='w-full bg-white/70 backdrop-blur border-b'>
      <div className='mx-auto max-w-6xl px-4 py-2 flex items-center gap-4 text-sm'>
        <Link href='/admin/schedule' className='underline hover:no-underline'>
          Admin · Schedule
        </Link>
        <Link href='/admin/staff' className='underline hover:no-underline'>
          Admin · Staff
        </Link>
        <Link href='/admin/bookings' className='underline hover:no-underline'>
          Admin · Bookings
        </Link>
        <Link
          href='/admin/assignments/swap'
          className='underline hover:no-underline'
        >
          Admin · Swap Assignments
        </Link>
      </div>
    </nav>
  );
}
