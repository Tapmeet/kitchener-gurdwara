// src/app/admin/bookings/page.tsx
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { ApproveButtons } from './parts';
import ReviewProposed from '@/components/admin/ReviewProposed';
import BookingTimeEditor from '@/components/admin/BookingTimeEditor';
import { fmtInVenue, DATE_TIME_FMT } from '@/lib/time';
import type { Prisma } from '@/generated/prisma/client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  const role = (session?.user as any)?.role ?? null;
  const isAdmin = role === 'ADMIN';

  if (!isAdmin) {
    return (
      <div className='p-6'>
        <h1 className='text-lg font-semibold'>Admin · Bookings</h1>
        <p className='mt-2 text-sm text-gray-600'>
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  // ⬇️ NEW: resolve the async searchParams once
  const params = await searchParams;

  const getParam = (key: string): string | undefined => {
    const v = params[key];
    if (Array.isArray(v)) return v[0];
    return v ?? undefined;
  };

  const rawPage = parseInt(getParam('page') ?? '1', 10);
  const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  const rawPageSize = parseInt(getParam('pageSize') ?? '20', 10);
  const pageSize =
    Number.isNaN(rawPageSize) || rawPageSize < 5
      ? 20
      : Math.min(rawPageSize, 100);

  // Filters
  const statusFilter = (getParam('status') ?? 'CONFIRMED').toUpperCase();
  const q = (getParam('q') ?? '').trim();
  const hallIdFilter = getParam('hallId') ?? '';
  const locationTypeFilter = (getParam('locationType') ?? '').toUpperCase();
  const fromStr = getParam('from') ?? '';
  const toStr = getParam('to') ?? '';

  const whereRecent: Prisma.BookingWhereInput = {};

  if (statusFilter && statusFilter !== 'ALL') {
    whereRecent.status = statusFilter as any;
  }

  if (hallIdFilter) {
    whereRecent.hallId = hallIdFilter;
  }

  if (
    locationTypeFilter &&
    (locationTypeFilter === 'GURDWARA' ||
      locationTypeFilter === 'OUTSIDE_GURDWARA')
  ) {
    whereRecent.locationType = locationTypeFilter as any;
  }

  if (fromStr || toStr) {
    whereRecent.start = {};
    if (fromStr) {
      (whereRecent.start as Prisma.DateTimeFilter).gte = new Date(
        `${fromStr}T00:00:00`
      );
    }
    if (toStr) {
      (whereRecent.start as Prisma.DateTimeFilter).lte = new Date(
        `${toStr}T23:59:59`
      );
    }
  }

  if (q) {
    whereRecent.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { contactName: { contains: q, mode: 'insensitive' } },
      { contactPhone: { contains: q, mode: 'insensitive' } },
      { contactEmail: { contains: q, mode: 'insensitive' } },
      { address: { contains: q, mode: 'insensitive' } },
    ];
  }

  const skip = (page - 1) * pageSize;

  const [pending, halls, totalRecent, recentBookings] = await Promise.all([
    prisma.booking.findMany({
      where: { status: 'PENDING' },
      orderBy: { start: 'asc' },
      include: {
        hall: true,
        items: { include: { programType: true } },
        assignments: {
          where: { state: 'PROPOSED' },
          orderBy: [{ start: 'asc' }, { booking: { start: 'asc' } }],
          include: {
            staff: true,
            bookingItem: { include: { programType: true } },
          },
        },
      },
    }),
    prisma.hall.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    }),
    prisma.booking.count({ where: whereRecent }),
    prisma.booking.findMany({
      where: whereRecent,
      orderBy: { start: 'desc' },
      skip,
      take: pageSize,
      include: {
        hall: true,
        items: { include: { programType: true } },
        assignments: {
          where: { state: 'CONFIRMED' },
          orderBy: [{ start: 'asc' }, { booking: { start: 'asc' } }],
          include: {
            staff: true,
            bookingItem: { include: { programType: true } },
          },
        },
      },
    }),
  ]);

  const fmt = (d: Date | string | number) => fmtInVenue(d, DATE_TIME_FMT);

  const totalPages = Math.max(
    1,
    Math.ceil((totalRecent || 0) / (pageSize || 1))
  );

  const baseFilters: Record<string, string> = {};
  if (q) baseFilters.q = q;
  if (statusFilter) baseFilters.status = statusFilter;
  if (hallIdFilter) baseFilters.hallId = hallIdFilter;
  if (locationTypeFilter) baseFilters.locationType = locationTypeFilter;
  if (fromStr) baseFilters.from = fromStr;
  if (toStr) baseFilters.to = toStr;
  if (pageSize !== 20) baseFilters.pageSize = String(pageSize);

  const buildPageHref = (targetPage: number) => {
    const usp = new URLSearchParams();
    Object.entries(baseFilters).forEach(([k, v]) => {
      if (v) usp.set(k, v);
    });
    usp.set('page', String(targetPage));
    const qs = usp.toString();
    return `/admin/bookings${qs ? `?${qs}` : ''}`;
  };

  const statusOptions = ['ALL', 'PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED'];

  return (
    <div className='p-6 space-y-8'>
      <h1 className='text-lg font-semibold'>Admin · Bookings</h1>

      {/* PENDING BOOKINGS */}
      <section>
        <h2 className='mb-3 font-semibold'>Pending approvals</h2>
        {pending.length === 0 ? (
          <div className='text-sm text-gray-600'>No pending bookings.</div>
        ) : (
          <div className='divide-y rounded-xl border'>
            {pending.map((b) => {
              const uniqueNames = Array.from(
                new Set(
                  b.assignments
                    .map((a) => a.staff?.name)
                    .filter(Boolean) as string[]
                )
              );

              const where =
                b.locationType === 'GURDWARA'
                  ? b.hall?.name
                    ? `Gurdwara — ${b.hall.name}`
                    : 'Gurdwara'
                  : b.address
                    ? `Outside — ${b.address}`
                    : 'Outside';

              return (
                <div
                  key={b.id}
                  className='flex flex-col gap-3 p-4 md:flex-row md:items-start'
                >
                  <div className='flex-1'>
                    <div className='font-medium'>{b.title}</div>
                    <div className='text-sm text-gray-600'>
                      {fmt(b.start)} – {fmt(b.end)} · {where}
                    </div>
                    <div className='mt-1 text-xs text-gray-500'>
                      Attendees: {b.attendees} · Contact: {b.contactName} (
                      {b.contactPhone}
                      {b.contactEmail ? `, ${b.contactEmail}` : ''})
                    </div>
                    <div className='mt-1 text-xs text-gray-500'>
                      Programs:{' '}
                      {b.items.map((i) => i.programType.name).join(', ')}
                    </div>
                    {uniqueNames.length ? (
                      <div className='mt-1 text-xs text-gray-700'>
                        Staff: {uniqueNames.join(', ')}
                      </div>
                    ) : null}

                    {/* Adjust time for pending bookings */}
                    <div className='mt-3'>
                      <BookingTimeEditor
                        bookingId={b.id}
                        initialStart={b.start}
                        initialEnd={b.end}
                      />
                    </div>

                    {/* Proposed assignment review UI */}
                    <div className='mt-3'>
                      <ReviewProposed bookingId={b.id} showApprove={false} />
                    </div>
                  </div>

                  <div className='flex flex-col gap-2 md:w-[240px]'>
                    <a
                      href={`/bookings/${b.id}/assignments`}
                      className='text-sm underline hover:no-underline'
                    >
                      Manage assignments
                    </a>
                    <ApproveButtons id={b.id} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ALL / RECENT BOOKINGS WITH FILTERS + PAGINATION */}
      <section className='space-y-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <h2 className='font-semibold'>Bookings (filtered & paginated)</h2>
          <span className='text-xs text-gray-500'>
            Showing page {page} of {totalPages} · {totalRecent} booking
            {totalRecent === 1 ? '' : 's'}
          </span>
        </div>

        {/* Filters */}
        <form
          method='GET'
          className='grid gap-3 rounded-xl border bg-white p-3 text-xs md:grid-cols-5 md:text-sm'
        >
          <div className='space-y-1'>
            <label className='block text-[0.7rem] font-medium uppercase tracking-wide text-gray-500'>
              Search
            </label>
            <input
              name='q'
              defaultValue={q}
              placeholder='Title, contact, address...'
              className='w-full rounded-md border border-black/10 px-2 py-1'
            />
          </div>

          <div className='space-y-1'>
            <label className='block text-[0.7rem] font-medium uppercase tracking-wide text-gray-500'>
              Status
            </label>
            <select
              name='status'
              defaultValue={statusFilter || 'CONFIRMED'}
              className='w-full rounded-md border border-black/10 px-2 py-1'
            >
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s === 'ALL' ? 'All statuses' : s}
                </option>
              ))}
            </select>
          </div>

          <div className='space-y-1'>
            <label className='block text-[0.7rem] font-medium uppercase tracking-wide text-gray-500'>
              Hall
            </label>
            <select
              name='hallId'
              defaultValue={hallIdFilter}
              className='w-full rounded-md border border-black/10 px-2 py-1'
            >
              <option value=''>Any hall</option>
              {halls.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>

          <div className='space-y-1'>
            <label className='block text-[0.7rem] font-medium uppercase tracking-wide text-gray-500'>
              Location
            </label>
            <select
              name='locationType'
              defaultValue={locationTypeFilter}
              className='w-full rounded-md border border-black/10 px-2 py-1'
            >
              <option value=''>Any</option>
              <option value='GURDWARA'>Gurdwara</option>
              <option value='OUTSIDE_GURDWARA'>Outside</option>
            </select>
          </div>

          <div className='space-y-1'>
            <label className='block text-[0.7rem] font-medium uppercase tracking-wide text-gray-500'>
              Date range
            </label>
            <div className='flex gap-1'>
              <input
                type='date'
                name='from'
                defaultValue={fromStr}
                className='w-1/2 rounded-md border border-black/10 px-2 py-1'
              />
              <input
                type='date'
                name='to'
                defaultValue={toStr}
                className='w-1/2 rounded-md border border-black/10 px-2 py-1'
              />
            </div>
          </div>

          <div className='md:col-span-5 flex items-center justify-between gap-2'>
            <div className='text-[0.7rem] text-gray-500'>
              Tip: combine filters (e.g., hall + date range + search).
            </div>
            <button
              type='submit'
              className='rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow hover:opacity-90'
            >
              Apply filters
            </button>
          </div>
        </form>

        {recentBookings.length === 0 ? (
          <div className='text-sm text-gray-600'>
            No bookings match these filters.
          </div>
        ) : (
          <div className='divide-y rounded-xl border'>
            {recentBookings.map((b) => {
              const uniqueNames = Array.from(
                new Set(
                  b.assignments
                    .map((a) => a.staff?.name)
                    .filter(Boolean) as string[]
                )
              );
              const where =
                b.locationType === 'GURDWARA'
                  ? b.hall?.name
                    ? `Gurdwara — ${b.hall.name}`
                    : 'Gurdwara'
                  : b.address
                    ? `Outside — ${b.address}`
                    : 'Outside';

              return (
                <div
                  key={b.id}
                  className='flex flex-col gap-3 p-4 md:flex-row md:items-start'
                >
                  <div className='flex-1'>
                    <div className='font-medium'>
                      {b.title}{' '}
                      <span className='ml-2 inline-flex items-center rounded-full border border-black/10 px-2 py-[2px] text-[0.65rem] uppercase tracking-wide text-gray-600'>
                        {b.status}
                      </span>
                    </div>
                    <div className='text-sm text-gray-600'>
                      {fmt(b.start)} – {fmt(b.end)} · {where}
                    </div>
                    <div className='mt-1 text-xs text-gray-500'>
                      Programs:{' '}
                      {b.items.map((i) => i.programType.name).join(', ')}
                    </div>
                    {uniqueNames.length ? (
                      <div className='mt-1 text-xs text-gray-700'>
                        Staff: {uniqueNames.join(', ')}
                      </div>
                    ) : null}
                  </div>

                  <div className='flex flex-col gap-2 text-sm md:w-[240px]'>
                    <a
                      href={`/bookings/${b.id}/assignments`}
                      className='underline hover:no-underline'
                    >
                      Manage assignments
                    </a>
                    <a
                      href={`/admin/bookings/${b.id}/edit`}
                      className='underline hover:no-underline'
                    >
                      Edit booking
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className='mt-4 flex items-center justify-between text-xs text-gray-600'>
            <span>
              Page {page} of {totalPages}
            </span>
            <div className='flex gap-2'>
              {page > 1 && (
                <a
                  href={buildPageHref(page - 1)}
                  className='rounded border border-black/10 px-2 py-1 hover:bg-black/5'
                >
                  Previous
                </a>
              )}
              {page < totalPages && (
                <a
                  href={buildPageHref(page + 1)}
                  className='rounded border border-black/10 px-2 py-1 hover:bg-black/5'
                >
                  Next
                </a>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
