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

  return (
    <html lang='en'>
      <body className='min-h-screen flex flex-col'>
        {/* ✅ pass the session to the client SessionProvider via Providers */}
        <Providers session={session}>
          <AdminSubnavClient />
          <NavBar />

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
