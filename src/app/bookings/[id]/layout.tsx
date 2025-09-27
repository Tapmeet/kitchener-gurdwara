// app/bookings/[id]/layout.tsx
import Link from 'next/link';

export default async function BookingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // ✅ await params

  return (
    <div className='space-y-4'>
      <nav className='text-sm text-gray-600'>
        <Link href='/bookings' className='hover:underline'>
          Bookings
        </Link>
        <span> / </span>
        <Link href={`/bookings/${id}`} className='hover:underline'>
          Booking {id}
        </Link>
        <span> / </span>
        <span className='font-medium text-gray-900'>Assignments</span>
      </nav>
      {children}
    </div>
  );
}
