'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type UserMeta = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | null;
};

type Props = {
  user: UserMeta | null;
  isAuthenticated: boolean;
  isPrivileged: boolean; // ADMIN or SECRETARY (computed server-side)
};

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

export default function NavBar({ user, isAuthenticated, isPrivileged }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close mobile menu on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close when clicking outside
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!open) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const displayName =
    user?.name || user?.email || (isAuthenticated ? 'User' : 'Guest');

  return (
    <header className='sticky top-0 z-40 backdrop-blur supports-[backdrop-filter]:bg-white/10 bg-gradient-to-br from-blue-600 to-indigo-600 text-white border-b border-white/15'>
      {/* Skip link */}
      <a
        href='#main-content'
        className='sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 bg-white text-blue-700 rounded px-3 py-1 text-sm shadow'
      >
        Skip to main content
      </a>

      <div className='container mx-auto px-4 py-4'>
        <div className='flex items-center justify-between gap-4'>
          {/* Brand */}
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
            {isAuthenticated && (
              <ActiveLink href='/dashboard'>Dashboard</ActiveLink>
            )}
            {isAuthenticated && isPrivileged && (
              <ActiveLink href='/admin'>Admin</ActiveLink>
            )}

            {!isAuthenticated ? (
              <Link
                href={`/login?callbackUrl=${encodeURIComponent('/')}`}
                className='ml-2 px-3 py-2 rounded-lg text-sm font-medium bg-white text-blue-700 hover:bg-white/90'
              >
                Login
              </Link>
            ) : (
              <>
                <span className='mx-1 text-white/90 hidden lg:inline'>
                  {displayName}
                </span>
                {/* Sign out (POST form for NextAuth) */}
                <form
                  action='/api/auth/signout'
                  method='post'
                  className='inline'
                >
                  <input type='hidden' name='callbackUrl' value='/' />
                  <button
                    type='submit'
                    className='ml-2 px-3 py-2 rounded-lg text-sm font-medium bg-white/10 text-white hover:bg-white/20 border border-white/20'
                  >
                    Sign out
                  </button>
                </form>
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
              {/* hamburger */}
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
              {isAuthenticated && (
                <ActiveLink href='/dashboard' onClick={() => setOpen(false)}>
                  Dashboard
                </ActiveLink>
              )}
              {isAuthenticated && isPrivileged && (
                <ActiveLink href='/admin' onClick={() => setOpen(false)}>
                  Admin
                </ActiveLink>
              )}

              <div className='my-2 border-t border-white/15' />

              {!isAuthenticated ? (
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent('/')}`}
                  onClick={() => setOpen(false)}
                  className='px-3 py-2 rounded-lg text-sm font-medium bg-white text-blue-700 hover:bg-white/90'
                >
                  Login
                </Link>
              ) : (
                <div className='flex items-center justify-between px-1 py-1.5'>
                  <span className='text-white/90'>{displayName}</span>
                  <form action='/api/auth/signout' method='post'>
                    <input type='hidden' name='callbackUrl' value='/' />
                    <button
                      type='submit'
                      className='px-3 py-2 rounded-lg text-sm font-medium bg-white/10 text-white hover:bg-white/20 border border-white/20'
                    >
                      Sign out
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
