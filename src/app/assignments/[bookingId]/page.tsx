// src/app/bookings/[id]/assignments/page.tsx
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';
import AssignmentsPanel from '@/components/AssignmentsPanel';

export const dynamic = 'force-dynamic';

type AllowedRole = 'ADMIN' | 'SECRETARY' | 'GRANTHI' | 'LANGRI' | 'VIEWER';
const ALLOWED = new Set<AllowedRole>([
  'ADMIN',
  'SECRETARY',
  'GRANTHI',
  'LANGRI',
]);

export default async function BookingAssignmentsPage({
  params,
}: {
  params: { id?: string };
}) {
  const id = params?.id?.trim();
  if (!id) {
    // No id in URL → send to home (or 404 if you prefer)
    redirect('/');
  }

  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: AllowedRole } | undefined)?.role;

  if (!role || !ALLOWED.has(role)) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/bookings/${id}/assignments`)}`
    );
  }

  return (
    <div className='p-6'>
      <h1 className='text-lg font-semibold'>Assignments</h1>
      <AssignmentsPanel bookingId={id} />
    </div>
  );
}
