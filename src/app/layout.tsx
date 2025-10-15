// src/app/layout.tsx
import './globals.css';
import type { Metadata } from 'next';
import Providers from './providers';
import NavBarBridge from '@/components/NavBarBridge';
import AdminSubnavClient from '@/components/AdminSubnavClient';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

export const metadata: Metadata = {
  title: 'Gurdwara Booking',
  description: 'Calendar & bookings for programs',
};

// Optional: helps avoid caching surprises for auth UI
export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang='en'>
      <body className='min-h-screen flex flex-col'>
        <Providers>
          <AdminSubnavClient />
          <NavBarBridge />

          <main
            id='main-content'
            className='container mx-auto px-4 py-8 flex-1'
          >
            {children}
          </main>

          <footer className='border-t border-black/5'>
            <div className='container mx-auto px-4 py-6 text-sm text-gray-500'>
              © {new Date().getFullYear()} Gurdwara Booking
            </div>
          </footer>

          <Analytics />
          <SpeedInsights />
        </Providers>
      </body>
    </html>
  );
}
