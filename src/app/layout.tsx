// src/app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import Providers from './providers';
import NavBar from '@/components/NavBar';
import AdminSubnavClient from '@/components/AdminSubnavClient';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Info } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Gurdwara Booking',
  description: 'Calendar & bookings for programs',
};

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const year = new Date().getFullYear(); // stable enough; or hardcode via build if you prefer
  const SHOW_NOTICE = (process.env.NEXT_PUBLIC_SHOW_NOTICE ?? '1') !== '0';

  return (
    <html lang='en'>
      <body className='min-h-screen flex flex-col'>
        {/* ✅ pass the session to the client SessionProvider via Providers */}
        <Providers session={session}>
          <AdminSubnavClient />
          <NavBar />

          {/* --- Notice block ------------------------------------------------ */}
          {SHOW_NOTICE && (
            <div className='container mx-auto px-4 mt-4'>
              <div
                className='relative overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 p-4 md:p-5 shadow-sm'
                role='status'
                aria-live='polite'
              >
                <div className='flex items-start gap-3'>
                  <svg
                    className='h-5 w-5 shrink-0 text-amber-600 mt-0.5'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    aria-hidden='true'
                  >
                    <circle cx='12' cy='12' r='10' />
                    <path d='M12 16v-4' />
                    <path d='M12 8h.01' />
                  </svg>
                  <div className='flex-1'>
                    <h2 className='text-sm font-semibold text-amber-900'>
                      Heads up: Prod environment
                    </h2>
                    <p className='mt-1 text-sm text-amber-900/80'>
                      Bookings are cleared{' '}
                      <span className='font-medium'>every day</span> for testing
                      purposes. Please keep adding more bookings so we can test
                      everything.
                    </p>
                    <p className='mt-1 text-xs text-amber-900/70'>
                      Side note: Email and SMS for the production environment
                      will start this month.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* ----------------------------------------------------------------- */}

          <main
            id='main-content'
            className='container mx-auto px-4 py-8 flex-1'
          >
            {children}
          </main>

          <footer className='border-t border-black/5'>
            <div className='container mx-auto px-4 py-6 text-sm text-gray-500'>
              {/* If you ever see a mismatch here (rare), wrap year in <span suppressHydrationWarning> */}
              © {year} Golden Triangle Sikh Association Booking
            </div>
          </footer>

          <Analytics />
          <SpeedInsights />
        </Providers>
      </body>
    </html>
  );
}
