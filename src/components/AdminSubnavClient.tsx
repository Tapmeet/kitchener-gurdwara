// src/components/AdminSubnavClient.tsx
'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { NAV_ITEMS } from '@/config/nav';

export default function AdminSubnavClient() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;

  // Only show for admins
  if (role !== 'ADMIN') return null;

  // Only admin routes in the strip
  const adminItems = NAV_ITEMS.filter((it) => it.href.startsWith('/admin'));

  if (!adminItems.length) return null;

  return (
    <nav className='w-full bg-white/70 backdrop-blur border-b'>
      <div className='mx-auto max-w-6xl px-4 py-2 flex items-center gap-4 text-sm'>
        {adminItems.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className='underline hover:no-underline'
          >
            {it.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
