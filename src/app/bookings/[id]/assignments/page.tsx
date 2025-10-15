// src/app/bookings/[id]/assignments/page.tsx
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import AssignmentsPanel from '@/components/AssignmentsPanel';
import SwapAssignmentsClient from '@/components/admin/SwapAssignmentsClient';

type Role = 'ADMIN' | 'STAFF' | 'LANGRI';
const ALLOWED: ReadonlySet<Role> = new Set(['ADMIN', 'STAFF', 'LANGRI']);

export default async function BookingAssignmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // Next 15: params is a Promise

  const session = await auth();
  const role = (session?.user as any)?.role as Role | undefined;

  if (!role || !ALLOWED.has(role)) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/bookings/${id}/assignments`)}`
    );
  }

  // 404 if no such booking
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!booking) notFound();

  const canSwap = role === 'ADMIN';

  return (
    <div className='p-6 space-y-6'>
      <AssignmentsPanel bookingId={id} />

      {canSwap && (
        <div className='mt-6 border-t pt-6'>
          <SwapAssignmentsClient bookingId={id} />
        </div>
      )}
    </div>
  );
}
