// src/components/TopNav.tsx
import Link from 'next/link';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
// (optional extra belt-and-suspenders)
// export const fetchCache = "force-no-store";

export default async function TopNav() {
  const session = await auth();
  const role = (session?.user as any)?.role ?? 'VIEWER';
  const canSeeMy =
    !!session?.user && ['ADMIN', 'STAFF', 'LANGRI'].includes(role);

  return (
    <header className='w-full border-b bg-white/60 backdrop-blur'>
      <div className='mx-auto max-w-6xl px-4 h-14 flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <Link href='/' className='font-semibold'>
            Kitchener Gurdwara
          </Link>
          <nav className='hidden md:flex items-center gap-4 text-sm text-gray-700'>
            <Link href='/bookings' className='hover:underline'>
              Bookings
            </Link>
            <Link href='/program-types' className='hover:underline'>
              Programs
            </Link>
            {canSeeMy && (
              // 🔁 point to the staff schedule page
              <Link href='/my-assignments' className='hover:underline'>
                My Schedule
              </Link>
              // If you do have /my-assignments, keep both or swap the href.
            )}
          </nav>
        </div>
        <div className='text-xs text-gray-500'>
          {session?.user ? (
            <span title={session.user.email ?? ''}>
              Signed in
              {(session.user as any)?.role
                ? ` (${(session.user as any).role})`
                : ''}
            </span>
          ) : (
            <Link href='/login' className='hover:underline'>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

// Optional: fix the admin check duplication
export async function AdminNavExtra() {
  const session = await auth();
  const isAdmin = (session?.user as any)?.role === 'ADMIN';
  if (!isAdmin) return null;
  return (
    <nav className='w-full border-t bg-white/60'>
      <div className='mx-auto max-w-6xl px-4 py-2'>
        <a
          href='/admin/schedule'
          className='text-sm underline hover:no-underline'
        >
          Admin Schedule
        </a>
      </div>
    </nav>
  );
}
