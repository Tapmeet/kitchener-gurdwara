// src/app/admin/space-bookings/page.tsx
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { VENUE_TZ } from '@/lib/businessHours';
import { formatInTimeZone } from 'date-fns-tz';
import type { SpaceRecurrence } from '@/generated/prisma/client';
import SpaceBookingLocationFields from '@/components/SpaceBookingLocationFields';

function offsetStrToMinutes(off: string): number {
  // off like "+05:30" or "-04:00"
  const sign = off.startsWith('-') ? -1 : 1;
  const [hh, mm] = off.slice(1).split(':').map(Number);
  return sign * (hh * 60 + (mm || 0));
}

/**
 * Convert a local date+time in the venue timezone (e.g. "2025-01-01", "09:30")
 * into a real UTC Date, using the venue TZ (America/Toronto by default).
 *
 * This is the same technique used in /api/availability, so space bookings
 * will line up exactly with normal bookings.
 */
function zonedLocalDateTimeToUtc(
  dateStr: string,
  timeStr: string,
  tz: string = VENUE_TZ
): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);

  // Initial guess: treat local wall-time components as if they were UTC
  let guess = new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0));

  // Get the zone offset (e.g. "-04:00") *at that instant*
  let offMin = offsetStrToMinutes(formatInTimeZone(guess, tz, 'xxx'));

  // Apply once
  let utc = new Date(guess.getTime() - offMin * 60_000);

  // One more iteration handles DST boundaries cleanly
  const offMin2 = offsetStrToMinutes(formatInTimeZone(utc, tz, 'xxx'));
  if (offMin2 !== offMin) {
    utc = new Date(guess.getTime() - offMin2 * 60_000);
  }

  return utc;
}

function isPriv(role?: string | null) {
  return role === 'ADMIN';
}

const TIME_SLOTS_24H = [
  '00:00',
  '00:30',
  '01:00',
  '01:30',
  '02:00',
  '02:30',
  '03:00',
  '03:30',
  '04:00',
  '04:30',
  '05:00',
  '05:30',
  '06:00',
  '06:30',
  '07:00',
  '07:30',
  '08:00',
  '08:30',
  '09:00',
  '09:30',
  '10:00',
  '10:30',
  '11:00',
  '11:30',
  '12:00',
  '12:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
  '17:30',
  '18:00',
  '18:30',
  '19:00',
  '19:30',
  '20:00',
  '20:30',
  '21:00',
  '21:30',
  '22:00',
  '22:30',
  '23:00',
  '23:30',
];

function displayTime(label: string) {
  const [hh, mm] = label.split(':').map(Number);
  const suffix = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm.toString().padStart(2, '0')} ${suffix}`;
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
  const startTimeStr = formData.get('startTime') as string | null;
  const endDateStr = formData.get('endDate') as string | null;
  const endTimeStr = formData.get('endTime') as string | null;
  const untilStr = formData.get('until') as string | null;

  if (!startDateStr || !startTimeStr || !endDateStr || !endTimeStr) return;

  const start = zonedLocalDateTimeToUtc(startDateStr, startTimeStr, VENUE_TZ);
  const end = zonedLocalDateTimeToUtc(endDateStr, endTimeStr, VENUE_TZ);
  if (end <= start) return;

  const locationTypeRaw = String(formData.get('locationType') ?? 'GURDWARA');
  const locationType =
    locationTypeRaw === 'OUTSIDE_GURDWARA' ? 'OUTSIDE_GURDWARA' : 'GURDWARA';

  const address =
    locationType === 'OUTSIDE_GURDWARA'
      ? String(formData.get('address') ?? '').trim() || null
      : null;

  // Outside space bookings should not reserve halls
  const blocksHall =
    locationType === 'GURDWARA' ? formData.get('blocksHall') === 'on' : false;

  const isPublicTitle = formData.get('isPublicTitle') !== null;

  const hallId =
    locationType === 'GURDWARA' && blocksHall
      ? (formData.get('hallId') as string | null) || null
      : null;

  if (locationType === 'OUTSIDE_GURDWARA' && !address) return;

  const until =
    recurrence === 'ONCE' || !untilStr || !untilStr.trim()
      ? null
      : zonedLocalDateTimeToUtc(untilStr, '23:59', VENUE_TZ);

  await prisma.spaceBooking.create({
    data: {
      title,
      description,
      locationType,
      address,
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
    <div className='p-b-6 space-y-6'>
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
        className='space-y-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm'
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
                &quot;Booked&quot;).
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
              name='startTime'
              required
              defaultValue=''
              className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
            >
              <option value='' disabled>
                Select time…
              </option>
              {TIME_SLOTS_24H.map((slot) => (
                <option key={slot} value={slot}>
                  {displayTime(slot)}
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
              name='endTime'
              required
              defaultValue=''
              className='w-full rounded-md border border-black/10 px-3 py-2 text-sm'
            >
              <option value='' disabled>
                Select time…
              </option>
              {TIME_SLOTS_24H.map((slot) => (
                <option key={slot} value={slot}>
                  {displayTime(slot)}
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
          <SpaceBookingLocationFields halls={halls} />
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
        <h2 className='mb-3 text-base font-semibold'>
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
                  <th className='px-3 py-2'>Recurrence</th>
                  <th className='px-3 py-2'>Location</th>
                  <th className='px-3 py-2'>Public title</th>
                  <th className='px-3 py-2'>Active</th>
                  <th className='py-2 pl-3 text-right'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {spaceBookings.map((b) => (
                  <tr
                    key={b.id}
                    className='align-top border-b border-black/5 last:border-0'
                  >
                    <td className='py-2 pr-3'>
                      <div className='font-medium'>{b.title}</div>
                      <div className='text-xs text-gray-500'>
                        First: {b.start.toLocaleString()}
                      </div>
                      {b.description && (
                        <div className='mt-1 whitespace-pre-wrap text-xs text-gray-600'>
                          {b.description}
                        </div>
                      )}
                    </td>
                    <td className='px-3 py-2'>
                      <div>{describeRecurrence(b.recurrence, b.interval)}</div>
                      {b.until && (
                        <div className='text-xs text-gray-500'>
                          Until {b.until.toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td className='px-3 py-2'>
                      {b.locationType === 'OUTSIDE_GURDWARA'
                        ? b.address || 'Outside (no address)'
                        : b.blocksHall
                          ? b.hall?.name || 'Reserved (no hall selected)'
                          : 'Gurdwara (does not reserve hall)'}
                    </td>
                    <td className='px-3 py-2'>
                      {b.isPublicTitle ? 'Yes' : 'No'}
                    </td>
                    <td className='px-3 py-2'>
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
