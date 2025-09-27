// src/app/book/page.tsx
import BookingForm from '@/components/BookingForm';

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const sp = await searchParams;
  const created = sp?.created;

  return (
    <div className='p-4 space-y-3'>
      {created && (
        <div className='alert alert-success'>
          Booking submitted! Reference: <code>{created}</code>
        </div>
      )}
      <BookingForm />
    </div>
  );
}
