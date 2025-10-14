// src/app/admin/assignments/swap/page.tsx
import { auth } from "@/lib/auth";
import Link from "next/link";
import SwapAssignmentsClient from "@/components/admin/SwapAssignmentsClient";

function isPriv(role?: string | null) {
  return role === "ADMIN";
}

export default async function Page() {
  const session = await auth();
  const role = (session?.user as any)?.role ?? null;
  if (!session?.user || !isPriv(role)) {
    return <div className="p-6">Unauthorized (admin/secretary only).</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Swap Assignments</h1>
        <div className="flex gap-3">
          <Link href="/admin/staff" className="text-sm underline hover:no-underline">Staff Overview</Link>
          <Link href="/admin/schedule" className="text-sm underline hover:no-underline">Monthly Schedule</Link>
        </div>
      </div>

      <p className="text-sm text-gray-600">
        Enter two <code>BookingAssignment</code> IDs to swap their assigned staff. Both assignments should be of the same category (e.g., KIRTAN ↔ KIRTAN).
      </p>

      <SwapAssignmentsClient />
    </div>
  );
}
