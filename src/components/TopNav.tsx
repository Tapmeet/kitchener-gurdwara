
// src/components/TopNav.tsx
import Link from "next/link";
import { auth } from "@/lib/auth";

/**
 * Server component: renders a top nav.
 * Shows "My Assignments" only when a user is signed in.
 */
export default async function TopNav() {
  const session = await auth();

  return (
    <header className="w-full border-b bg-white/60 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-semibold">Kitchener Gurdwara</Link>
          <nav className="hidden md:flex items-center gap-4 text-sm text-gray-700">
            <Link href="/bookings" className="hover:underline">Bookings</Link>
            <Link href="/program-types" className="hover:underline">Programs</Link>
            {session?.user ? (
              <Link href="/my-assignments" className="hover:underline">My Assignments</Link>
            ) : null}
          </nav>
        </div>
        <div className="text-xs text-gray-500">
          {session?.user ? (
            <span title={session.user.email ?? ""}>
              Signed in{session.user.role ? ` (${session.user.role})` : ""}
            </span>
          ) : (
            <Link href="/login" className="hover:underline">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}


// (Note) Admin-only shortcut in the nav:
/* This block is appended to keep the original nav simple.
   It conditionally shows Admin Schedule if user is admin/secretary. */
export async function AdminNavExtra() {
  const session = await auth();
  const isAdmin = session?.user && ((session.user as any).role === "ADMIN" || (session.user as any).role === "ADMIN");
  if (!isAdmin) return null;
  return (
    <nav className="w-full border-t bg-white/60">
      <div className="mx-auto max-w-6xl px-4 py-2">
        <a href="/admin/schedule" className="text-sm underline hover:no-underline">Admin Schedule</a>
      </div>
    </nav>
  );
}
