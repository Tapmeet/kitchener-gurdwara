import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Gurdwara Booking',
  description: 'Calendar & bookings for programs',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Header */}
        <div className='bg-gradient-to-br from-blue-600 to-indigo-600 text-white'>
          <div className='container py-6'>
            <div className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
              <div>
                <h1 className='text-2xl font-bold tracking-tight'>
                  Gurdwara Booking
                </h1>
                <p className='text-white/80 text-sm'>
                  Reserve halls, home visits, and manage program capacity.
                </p>
              </div>
              <nav className='flex gap-2'>
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
      </body>
    </html>
  );
}
