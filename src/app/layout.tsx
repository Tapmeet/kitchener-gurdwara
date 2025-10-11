import './globals.css';
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import NavBar from '@/components/NavBar';

// ✅ Vercel Analytics & Speed Insights
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

export const metadata: Metadata = {
  title: 'Gurdwara Booking',
  description: 'Calendar & bookings for programs',
};

// --- Admin secondary nav (server component) ---
export async function AdminSubnav() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role ?? null;
  const isAdmin = role === "ADMIN";
  if (!isAdmin) return null;
  return (
    <nav className="w-full bg-white/70 backdrop-blur border-b">
      <div className="mx-auto max-w-6xl px-4 py-2 flex items-center gap-4 text-sm">
        <a href="/admin/schedule" className="underline hover:no-underline">Admin · Schedule</a>
        <a href="/admin/staff" className="underline hover:no-underline">Admin · Staff</a>
        <a href="/admin/bookings" className="underline hover:no-underline">Admin · Bookings</a>
        <a href="/admin/assignments/swap" className="underline hover:no-underline">Admin · Swap Assignments</a>
      </div>
    </nav>
  );
}


function computePrivileged(session: any): boolean {
  const role = (session?.user as any)?.role;
  if (role === "ADMIN") return true;
  // optional fallback: env-based email allowlist
  const email = session?.user?.email?.toLowerCase() ?? '';
  const admins = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && admins.includes(email);
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  const isAuthenticated = !!session?.user;
  const isPrivileged = computePrivileged(session);

  const user = {
    name: session?.user?.name ?? null,
    email: session?.user?.email ?? null,
    image: (session?.user as any)?.image ?? null,
    role: (session?.user as any)?.role ?? null,
  };

  return (
    <html lang='en' suppressHydrationWarning>
      <body className='min-h-screen flex flex-col' suppressHydrationWarning>
      <AdminSubnav />
        <NavBar
          user={isAuthenticated ? user : null}
          isAuthenticated={isAuthenticated}
          isPrivileged={isPrivileged}
        />

        {/* Page */}
        <main id='main-content' className='container mx-auto px-4 py-8 flex-1'>
          {children}
        </main>

        {/* Footer */}
        <footer className='border-t border-black/5'>
          <div className='container mx-auto px-4 py-6 text-sm text-gray-500'>
            © {new Date().getFullYear()} Gurdwara Booking
          </div>
        </footer>

        {/* ✅ Vercel trackers */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
