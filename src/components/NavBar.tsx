'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';

type Role = 'ADMIN' | 'STAFF' | 'LANGRI' | 'VIEWER' | (string & {});

function ActiveLink({
  href,
  children,
  onClick,
  className,
}: {
  href: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const active =
    href === '/'
      ? pathname === '/'
      : pathname === href || pathname?.startsWith(href + '/');

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={[
        'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
        active
          ? 'bg-white/15 text-white'
          : 'text-white/90 hover:text-white hover:bg-white/10',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </Link>
  );
}

export default function NavBar() {
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated';
  const role = ((session?.user as any)?.role ?? 'VIEWER') as Role;

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!open) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node))
        setOpen(false);
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const displayName =
    session?.user?.name ||
    session?.user?.email ||
    (isAuthenticated ? 'User' : 'Guest');

  const canSeeMySchedule =
    isAuthenticated && (role === 'STAFF' || role === 'LANGRI');

  return (
    <header className='sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-white/10 bg-gradient-to-br from-blue-600 to-indigo-600 text-white border-b border-white/15'>
      <a
        href='#main-content'
        className='sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 bg-white text-blue-700 rounded px-3 py-1 text-sm shadow'
      >
        Skip to main content
      </a>

      <div className='container mx-auto px-4 py-4'>
        <div className='flex items-center justify-between gap-4'>
          <Link href='/' className='group inline-flex items-center gap-3'>
            <div>
              <h1 className='text-xl md:text-2xl font-bold tracking-tight'>
                Kitchener Gurdwara
              </h1>
              <p className='text-white/80 text-xs md:text-sm'>
                Book halls & home occasions
              </p>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav
            role='navigation'
            aria-label='Primary'
            className='hidden md:flex items-center gap-2'
          >
            <ActiveLink href='/'>Calendar</ActiveLink>
            <ActiveLink href='/book'>Book</ActiveLink>
            {canSeeMySchedule && (
              <ActiveLink href='/my-assignments'>My Schedule</ActiveLink>
            )}

            {!isAuthenticated ? (
              <button
                onClick={() => signIn(undefined, { callbackUrl: '/' })}
                className='ml-2 px-3 py-2 rounded-lg text-sm font-medium bg-white text-blue-700 hover:bg-white/90'
              >
                Login
              </button>
            ) : (
              <>
                <span className='mx-1 text-white/90 hidden lg:inline'>
                  {displayName}
                </span>
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className='ml-2 px-3 py-2 rounded-lg text-sm font-medium bg-white/10 text-white hover:bg.white/20 border border-white/20'
                >
                  Sign out
                </button>
              </>
            )}
          </nav>

          {/* Mobile toggle */}
          <div className='md:hidden'>
            <button
              aria-label='Open navigation menu'
              aria-controls='mobile-nav'
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className='inline-flex items-center justify-center rounded-lg p-2 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40'
            >
              <svg
                width='22'
                height='22'
                viewBox='0 0 24 24'
                aria-hidden='true'
              >
                <path
                  d='M4 7h16M4 12h16M4 17h16'
                  stroke='currentColor'
                  strokeWidth='2'
                  strokeLinecap='round'
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile panel */}
        {open && (
          <div
            id='mobile-nav'
            ref={panelRef}
            className='mt-3 rounded-2xl border border-white/15 bg-white/10 backdrop-blur p-2 shadow-2xl md:hidden'
          >
            <div className='flex flex-col'>
              <ActiveLink href='/' onClick={() => setOpen(false)}>
                Calendar
              </ActiveLink>
              <ActiveLink href='/book' onClick={() => setOpen(false)}>
                Book
              </ActiveLink>
              {canSeeMySchedule && (
                <ActiveLink
                  href='/my-assignments'
                  onClick={() => setOpen(false)}
                >
                  My Schedule
                </ActiveLink>
              )}
              <div className='my-2 border-t border-white/15' />
              {!isAuthenticated ? (
                <button
                  onClick={() => {
                    setOpen(false);
                    signIn(undefined, { callbackUrl: '/' });
                  }}
                  className='px-3 py-2 rounded-lg text-sm font-medium bg-white text-blue-700 hover:bg-white/90'
                >
                  Login
                </button>
              ) : (
                <div className='flex items-center justify-between px-1 py-1.5'>
                  <span className='text-white/90'>{displayName}</span>
                  <button
                    onClick={() => {
                      setOpen(false);
                      signOut({ callbackUrl: '/' });
                    }}
                    className='px-3 py-2 rounded-lg text-sm font-medium bg-white/10 text-white hover:bg-white/20 border border-white/20'
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
