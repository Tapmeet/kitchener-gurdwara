// src/app/bookings/[id]/assignments/page.tsx
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import AssignmentsPanel from '@/components/AssignmentsPanel';

const ALLOWED = new Set(['ADMIN', 'SECRETARY', 'GRANTHI', 'LANGRI']);

export default async function BookingAssignmentsPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role as string | undefined;

  if (!role || !ALLOWED.has(role)) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(
        `/bookings/${params.id}/assignments`
      )}`
    );
  }

  return (
    <div className='p-6'>
      <h1 className='text-lg font-semibold'>Assignments</h1>
      <AssignmentsPanel bookingId={params.id} />
    </div>
  );
}
