// src/app/admin/space-bookings/page.tsx
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { BUSINESS_HOURS_24 } from '@/lib/businessHours';
import type { SpaceRecurrence } from '@/generated/prisma/client'; // adjust path if needed

const pad2 = (n: number) => String(n).padStart(2, '0');

function hourLabel(h: number) {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hr12 = h % 12 || 12;
  return `${hr12}:00 ${suffix}`;
}

function isPriv(role?: string | null) {
  return role === 'ADMIN';
}

// ---- server actions ----

async function createSpaceBooking(formData: FormData) {
  'use server';

  const session = await auth();
  const role = (session?.user as any)?.role ?? null;
  if (!isPriv(role)) {
    throw new Error('Unauthorized');
  }

  const title = String(formData.get('title') ?? '').trim();
  if (!title) return;

  const description = (formData.get('description') as string | null) || null;

  const recurrence =
    (formData.get('recurrence') as SpaceRecurrence | null) ?? 'ONCE';
  const intervalRaw = (formData.get('interval') as string | null) ?? '1';
  const interval = Math.max(1, Number(intervalRaw) || 1);

  const startDateStr = formData.get('startDate') as string | null;
  const endDateStr = formData.get('endDate') as string | null;
  const startHourStr = formData.get('startHour') as string | null;
  const endHourStr = formData.get('endHour') as string | null;
  const untilStr = formData.get('until') as string | null;

  if (!startDateStr || !endDateStr || !startHourStr || !endHourStr) return;

  // Build ISO-ish strings with minutes fixed to :00
  const start = new Date(`${startDateStr}T${startHourStr}:00`);
  const end = new Date(`${endDateStr}T${endHourStr}:00`);

  if (isNaN(+start) || isNaN(+end)) return;
  if (end <= start) return;

  const blocksHall = formData.get('blocksHall') === 'on';
  const isPublicTitle = formData.get('isPublicTitle') !== null; // checkbox
  const hallId = blocksHall
    ? (formData.get('hallId') as string | null) || null
    : null;

  const until =
    recurrence === 'ONCE' || !untilStr || !untilStr.trim()
      ? null
      : new Date(untilStr);

  await prisma.spaceBooking.create({
    data: {
      title,
      description,
      locationType: 'GURDWARA',
      blocksHall,
      isPublicTitle,
      start,
      end,
      recurrence,
      interval,
      until,
      hallId,
      createdById: (session?.user as any)?.id ?? null,
    },
  });

  revalidatePath('/');
  revalidatePath('/admin/space-bookings');
}

async function toggleSpaceBooking(formData: FormData) {
  'use server';

  const session = await auth();
  const role = (session?.user as any)?.role ?? null;
  if (!isPriv(role)) {
    throw new Error('Unauthorized');
  }

  const id = formData.get('id') as string | null;
  if (!id) return;

  const existing = await prisma.spaceBooking.findUnique({ where: { id } });
  if (!existing) return;

  await prisma.spaceBooking.update({
    where: { id },
    data: { isActive: !existing.isActive },
  });

  revalidatePath('/');
  revalidatePath('/admin/space-bookings');
}

async function deleteSpaceBooking(formData: FormData) {
  'use server';

  const session = await auth();
  const role = (session?.user as any)?.role ?? null;
  if (!isPriv(role)) {
    throw new Error('Unauthorized');
  }

  const id = formData.get('id') as string | null;
  if (!id) return;

  await prisma.spaceBooking.delete({ where: { id } });

  revalidatePath('/');
  revalidatePath('/admin/space-bookings');
}

function describeRecurrence(rec: SpaceRecurrence, interval: number) {
  const every = interval === 1 ? 'Every' : `Every ${interval}`;
  switch (rec) {
    case 'ONCE':
      return 'One-time';
    case 'DAILY':
      return `${every} day`;
    case 'WEEKLY':
      return `${every} week`;
    case 'MONTHLY':
      return `${every} month`;
    case 'YEARLY':
      return `${every} year`;
    default:
      return 'One-time';
  }
}

export default async function AdminSpaceBookingsPage() {
  const session = await auth();
  const role = (session?.user as any)?.role ?? null;

  if (!isPriv(role)) {
    return (
      <div className='mx-auto mt-8 max-w-xl rounded-xl bg-red-50 p-6 text-sm text-red-700'>
        Unauthorized (admin only).
      </div>
    );
  }

  const [halls, spaceBookings] = await Promise.all([
    prisma.hall.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    }),
    prisma.spaceBooking.findMany({
      orderBy: [{ start: 'asc' }, { title: 'asc' }],
      include: {
        hall: true,
        createdBy: true,
      },
    }),
  ]);

  return (
    <div className='p-6 space-y-6'>
      <div>
        <h1 className='text-xl font-semibold'>Admin · Space Bookings</h1>
        <p className='mt-1 text-sm text-gray-600'>
          Use this to block recurring programs like <b>Gurmukhi Classes</b> on
          the calendar. You can optionally reserve a specific hall, or keep
          halls fully available.
        </p>
      </div>

      {/* Create form */}
      <form
        action={createSpaceBooking}
        className='rounded-2xl border border-black/10 bg-white p-5 shadow-sm space-y-4'
      >
        <h2 className='text-base font-semibold'>New Space Booking</h2>

        <div className='grid gap-4 md:grid-cols-2'>
          <div className='space-y-2'>
            <label className='block text-sm font-medium'>Title</label>
            <input
              name='title'
              className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
              placeholder='e.g. Gurmukhi Classes'
              required
            />
          </div>

          <div className='space-y-2'>
            <label className='block text-sm font-medium'>
              Show title to public?
            </label>
            <label className='inline-flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                name='isPublicTitle'
                defaultChecked
                className='rounded border-black/20'
              />
              <span>
                Yes, public calendar should show this title (instead of
                “Booked”).
              </span>
            </label>
          </div>

          {/* Start date + hour (like Edit Booking UI) */}
          <div className='space-y-2'>
            <label className='block text-sm font-medium'>Start date</label>
            <input
              type='date'
              name='startDate'
              required
              className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
            />
          </div>

          <div className='space-y-2'>
            <label className='block text-sm font-medium'>Start time</label>
            <select
              name='startHour'
              required
              defaultValue=''
              className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
            >
              <option value='' disabled>
                Select time…
              </option>
              {BUSINESS_HOURS_24.map((h) => (
                <option key={h} value={pad2(h)}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </div>

          {/* End date + hour */}
          <div className='space-y-2'>
            <label className='block text-sm font-medium'>End date</label>
            <input
              type='date'
              name='endDate'
              required
              className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
            />
          </div>

          <div className='space-y-2'>
            <label className='block text-sm font-medium'>End time</label>
            <select
              name='endHour'
              required
              defaultValue=''
              className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
            >
              <option value='' disabled>
                Select time…
              </option>
              {BUSINESS_HOURS_24.map((h) => (
                <option key={h} value={pad2(h)}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </div>

          <div className='space-y-2'>
            <label className='block text-sm font-medium'>Recurrence</label>
            <select
              name='recurrence'
              className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
              defaultValue='WEEKLY'
            >
              <option value='ONCE'>One-time</option>
              <option value='DAILY'>Daily</option>
              <option value='WEEKLY'>Weekly</option>
              <option value='MONTHLY'>Monthly</option>
              <option value='YEARLY'>Yearly</option>
            </select>
          </div>

          <div className='space-y-2'>
            <label className='block text-sm font-medium'>Repeat every</label>
            <div className='flex items-center gap-2'>
              <input
                type='number'
                min={1}
                name='interval'
                defaultValue={1}
                className='w-20 rounded-md border border-black/10 px-2 py-1 text-sm'
              />
              <span className='text-sm text-gray-600'>unit(s)</span>
            </div>
          </div>

          <div className='space-y-2'>
            <label className='block text-sm font-medium'>
              Repeat until (optional)
            </label>
            <input
              type='date'
              name='until'
              className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
            />
            <p className='mt-1 text-xs text-gray-500'>
              Leave empty for no end date.
            </p>
          </div>

          <div className='space-y-2'>
            <label className='block text-sm font-medium'>
              Hall reservation
            </label>
            <div className='space-y-2 text-sm'>
              <label className='flex items-center gap-2'>
                <input
                  type='checkbox'
                  name='blocksHall'
                  defaultChecked
                  className='rounded border-black/20'
                />
                <span>Reserve a specific hall for this time slot</span>
              </label>
              <select
                name='hallId'
                className='mt-1 w-full rounded-md border border-black/10 px-3 py-2 text-sm'
                defaultValue=''
              >
                <option value=''>Choose hall…</option>
                {halls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <p className='text-xs text-gray-500'>
                If you uncheck “Reserve hall”, this will still appear on the
                calendar but all halls remain available for normal bookings.
              </p>
            </div>
          </div>
        </div>

        <div className='space-y-2'>
          <label className='block text-sm font-medium'>
            Description (optional)
          </label>
          <textarea
            name='description'
            rows={3}
            className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
            placeholder='Short notes, e.g. age group, teacher name, etc.'
          />
        </div>

        <div className='flex justify-end'>
          <button
            type='submit'
            className='rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:opacity-90'
          >
            Save Space Booking
          </button>
        </div>
      </form>

      {/* Existing space bookings */}
      <div className='rounded-2xl border border-black/10 bg-white p-5 shadow-sm'>
        <h2 className='text-base font-semibold mb-3'>
          Existing Space Bookings
        </h2>

        {spaceBookings.length === 0 ? (
          <p className='text-sm text-gray-600'>No space bookings yet.</p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='min-w-full text-sm'>
              <thead>
                <tr className='border-b border-black/10 text-left text-xs uppercase tracking-wide text-gray-500'>
                  <th className='py-2 pr-3'>Title</th>
                  <th className='py-2 px-3'>Recurrence</th>
                  <th className='py-2 px-3'>Hall</th>
                  <th className='py-2 px-3'>Public title</th>
                  <th className='py-2 px-3'>Active</th>
                  <th className='py-2 pl-3 text-right'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {spaceBookings.map((b) => (
                  <tr
                    key={b.id}
                    className='border-b border-black/5 last:border-0 align-top'
                  >
                    <td className='py-2 pr-3'>
                      <div className='font-medium'>{b.title}</div>
                      <div className='text-xs text-gray-500'>
                        First: {b.start.toLocaleString()}
                      </div>
                      {b.description && (
                        <div className='mt-1 text-xs text-gray-600 whitespace-pre-wrap'>
                          {b.description}
                        </div>
                      )}
                    </td>
                    <td className='py-2 px-3'>
                      <div>{describeRecurrence(b.recurrence, b.interval)}</div>
                      {b.until && (
                        <div className='text-xs text-gray-500'>
                          Until {b.until.toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className='py-2 px-3'>
                      {b.blocksHall
                        ? b.hall?.name || 'Reserved (no hall selected)'
                        : 'Does not reserve hall'}
                    </td>
                    <td className='py-2 px-3'>
                      {b.isPublicTitle ? 'Yes' : 'No'}
                    </td>
                    <td className='py-2 px-3'>
                      {b.isActive ? 'Active' : 'Inactive'}
                    </td>
                    <td className='py-2 pl-3'>
                      <div className='flex justify-end gap-2'>
                        <form action={toggleSpaceBooking}>
                          <input type='hidden' name='id' value={b.id} />
                          <button
                            type='submit'
                            className='rounded-md border border-black/10 px-3 py-1 text-xs hover:bg-black/5'
                          >
                            {b.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                        </form>
                        <form action={deleteSpaceBooking}>
                          <input type='hidden' name='id' value={b.id} />
                          <button
                            type='submit'
                            className='rounded-md border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50'
                          >
                            Delete
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className='mt-3 text-xs text-gray-500'>
          Note: deleting a space booking removes it from the calendar
          immediately. Existing normal bookings are not touched.
        </p>
      </div>
    </div>
  );
}
