export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { notFound, redirect } from 'next/navigation';
import BookingEditForm from '@/components/admin/BookingEditForm';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminBookingEditPage({ params }: PageProps) {
  const { id } = await params;

  const session = await auth();
  const role = (session?.user as any)?.role ?? null;

  if (!session?.user || role !== 'ADMIN') {
    redirect(`/login?callbackUrl=/admin/bookings/${id}/edit`);
  }

  const [booking, halls] = await Promise.all([
    prisma.booking.findUnique({
      where: { id },
      include: {
        hall: {
          select: {
            id: true,
            name: true,
          },
        },
        items: {
          include: {
            programType: {
              select: {
                name: true,
                durationMinutes: true,
              },
            },
          },
        },
      },
    }),
    prisma.hall.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
      },
    }),
  ]);

  if (!booking) {
    notFound();
  }

  // Derive block duration from program types
  const maxDurationMinutes =
    booking.items.length > 0
      ? Math.max(
          ...booking.items.map((i) => i.programType.durationMinutes ?? 60)
        )
      : 60;

  const blockHours = Math.max(1, Math.ceil(maxDurationMinutes / 60));

  return (
    <div className='p-6 max-w-3xl space-y-6 mx-auto'>
      <h1 className='text-lg font-semibold'>Admin · Edit booking</h1>
      <p className='text-xs text-gray-500'>Booking ID: {booking.id}</p>

      <BookingEditForm
        booking={{
          id: booking.id,
          title: booking.title,
          start: booking.start.toISOString(),
          end: booking.end.toISOString(),
          locationType: booking.locationType as 'GURDWARA' | 'OUTSIDE_GURDWARA',
          hallId: booking.hallId,
          hallName: booking.hall?.name ?? null,
          address: booking.address,
          attendees: booking.attendees,
          contactName: booking.contactName,
          contactPhone: booking.contactPhone,
          contactEmail: booking.contactEmail,
          notes: booking.notes,
          status: booking.status,
          programNames: booking.items.map((i) => i.programType.name),
          blockHours,
        }}
        halls={halls}
      />
    </div>
  );
}
