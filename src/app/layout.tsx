import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';

// ✅ Vercel Analytics & Speed Insights
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

export const metadata: Metadata = {
  title: 'Gurdwara Booking',
  description: 'Calendar & bookings for programs',
};

function isAdminEmail(email?: string | null) {
  const admins = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && admins.includes(email.toLowerCase());
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  const name = session?.user?.name ?? email ?? 'User';
  const admin = isAdminEmail(email);

  return (
    <html lang='en' suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Header */}
        <div className='bg-gradient-to-br from-blue-600 to-indigo-600 text-white'>
          <div className='container py-6'>
            <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
              <Link
                href={'/'}
                className='decoration-2'
              >
                <div>
                  <h1 className='text-2xl font-bold tracking-tight'>
                    Kitchener Gurdwara
                  </h1>
                  <p className='text-white/80 text-sm'>
                    Book Gurdwara halls and home occasions in minutes
                  </p>
                </div>
              </Link>

              <nav className='flex gap-2 items-center'>
                <Link
                  className='btn btn-ghost text-white/90 hover:text-white'
                  href='/'
                >
                  Calendar
                </Link>
                <Link
                  className='btn btn-outline bg-white/10 text-white hover:bg-white/20'
                  href='/book'
                >
                  Book
                </Link>

                {/* Auth-aware actions */}
                {!session ? (
                  <Link
                    className='btn bg-white text-blue-700 hover:bg-white/90'
                    href={`/login?callbackUrl=${encodeURIComponent('/')}`}
                  >
                    Login
                  </Link>
                ) : (
                  <>
                    <span className='hidden sm:inline text-white/90 mx-2'>
                      {name}
                    </span>

                    <Link
                      className='btn btn-ghost text-white/90 hover:text-white'
                      href='/dashboard'
                    >
                      Dashboard
                    </Link>

                    {admin && (
                      <Link
                        className='btn btn-ghost text-white/90 hover:text-white'
                        href='/admin'
                      >
                        Admin
                      </Link>
                    )}

                    {/* Sign out via POST form to NextAuth */}
                    <form
                      action='/api/auth/signout'
                      method='post'
                      className='inline'
                    >
                      <input type='hidden' name='callbackUrl' value='/' />
                      <button
                        type='submit'
                        className='btn btn-outline bg-white/10 text-white hover:bg-white/20'
                      >
                        Sign out
                      </button>
                    </form>
                  </>
                )}
              </nav>
            </div>
          </div>
        </div>
        {/* Page */}
        <main className='container py-8'>{children}</main>
        {/* Footer */}
        <footer className='border-t border-black/5'>
          <div className='container py-6 text-sm text-gray-500'>
            © {new Date().getFullYear()} Gurdwara Booking
          </div>
        </footer>
        {/* ✅ Mount Vercel trackers at the end of <body> */}
        <Analytics /> {/* automatic pageviews + web vitals on Vercel */}
        <SpeedInsights /> {/* real-user performance traces */}
      </body>
    </html>
  );
}
