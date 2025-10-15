// src/app/admin/schedule/page.tsx
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import {
  startOfWeek,
  endOfWeek,
  parseISO,
  isValid,
  addMonths,
  eachMonthOfInterval,
  startOfMonth,
  endOfMonth,
} from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import Link from 'next/link';

// ---------- types ----------
type Role = 'PATH' | 'KIRTAN';
type Jatha = 'A' | 'B';

// Use one deterministic timezone everywhere we render dates
const TZ = process.env.NEXT_PUBLIC_TIMEZONE || 'America/Toronto';

// Stable formatter for any Date/string/number
function fmtDate(
  d: Date | string | number,
  pattern = 'EEE, MMM d yyyy, h:mm a'
) {
  try {
    const date = d instanceof Date ? d : new Date(d);
    return formatInTimeZone(date, TZ, pattern);
  } catch {
    return new Date(d as any).toString();
  }
}

function isAdminRole(role?: string | null) {
  return role === 'ADMIN';
}

function locLine(b: {
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hall?: { name: string } | null;
  address?: string | null;
}) {
  if (b.locationType === 'GURDWARA')
    return b.hall?.name ? `Gurdwara — ${b.hall.name}` : 'Gurdwara';
  return b.address ? `Outside — ${b.address}` : 'Outside';
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default async function Page({
  searchParams,
}: {
  // Keep compatibility with your original typing
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user || !isAdminRole((session.user as any).role)) {
    return <div className='p-6'>Unauthorized (admin/secretary only).</div>;
  }

  const params = await searchParams;

  // --- Range selection ---
  // Support both old `week` param and new `from` param. Default to today.
  const fromRaw =
    typeof params?.from === 'string'
      ? params.from
      : typeof params?.week === 'string'
        ? params.week
        : undefined;

  const fromDate = fromRaw ? parseISO(fromRaw) : new Date();
  const base = isValid(fromDate)
    ? startOfWeek(fromDate, { weekStartsOn: 1 })
    : startOfWeek(new Date(), { weekStartsOn: 1 });

  const monthsParam =
    typeof params?.months === 'string' ? parseInt(params.months, 10) : 3;
  const months = clamp(Number.isFinite(monthsParam) ? monthsParam : 3, 1, 6);

  const rangeStart = base; // inclusive
  const rangeEnd = endOfWeek(addMonths(base, months), { weekStartsOn: 1 }); // inclusive end of final week

  // --- Filters ---
  const role = (typeof params?.role === 'string' ? params?.role : '') as
    | Role
    | '';
  const jatha = (typeof params?.jatha === 'string' ? params?.jatha : '') as
    | Jatha
    | '';
  const q = (typeof params?.q === 'string' ? params?.q : '')
    .trim()
    .toLowerCase();

  // --- Load active staff (filterable) ---
  const staff = await prisma.staff.findMany({
    where: {
      isActive: true,
      ...(jatha ? { jatha } : {}),
      ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
    },
    orderBy: [{ jatha: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      jatha: true,
      skills: true,
      email: true,
      phone: true,
    },
  });

  const staffIds = staff.map((s) => s.id);

  // --- Fetch assignments overlapping [rangeStart, rangeEnd] ---
  const assignments = staffIds.length
    ? await prisma.bookingAssignment.findMany({
        where: {
          staffId: { in: staffIds },
          booking: { status: 'CONFIRMED' },
          OR: [
            // windowed shifts: [a.start, a.end) overlaps [rangeStart, rangeEnd)
            { AND: [{ start: { lt: rangeEnd } }, { end: { gt: rangeStart } }] },
            // unwindowed (null start/end) → fall back to booking overlap
            {
              AND: [
                { start: null },
                { end: null },
                {
                  booking: { start: { lt: rangeEnd }, end: { gt: rangeStart } },
                },
              ],
            },
          ],
          ...(role ? { bookingItem: { programType: { category: role } } } : {}),
        },
        include: {
          staff: { select: { id: true } },
          booking: { include: { hall: true } },
          bookingItem: { include: { programType: true } },
        },
        orderBy: [
          { start: 'asc' }, // for windowed assignments
          { booking: { start: 'asc' } }, // fallback
        ],
      })
    : [];

  // Group staff → their assignments
  const byStaff = new Map<string, typeof assignments>();
  for (const s of staff) byStaff.set(s.id, [] as any);
  for (const a of assignments) byStaff.get(a.staff.id)!.push(a);

  // Compute the months in the interval for sectioning
  const monthsInRange = eachMonthOfInterval({
    start: rangeStart,
    end: rangeEnd,
  });

  const rangeLabel = `${fmtDate(rangeStart, 'MMM d, yyyy')} – ${fmtDate(
    rangeEnd,
    'MMM d, yyyy'
  )}`;

  // Prev/Next navigation jumps by the selected number of months
  const prevFrom = fmtDate(addMonths(rangeStart, -months), 'yyyy-MM-dd');
  const nextFrom = fmtDate(addMonths(rangeStart, months), 'yyyy-MM-dd');

  return (
    <div className='p-6 space-y-6'>
      {/* Header / Filters */}
      <div className='flex items-center justify-between gap-4 flex-wrap'>
        <h1 className='text-xl font-semibold'>Staff Schedule</h1>

        <form
          className='flex items-center gap-2'
          action='/admin/schedule'
          method='get'
        >
          <input
            type='date'
            name='from'
            className='border rounded px-2 py-1 text-sm'
            defaultValue={fmtDate(rangeStart, 'yyyy-MM-dd')}
            aria-label='From'
          />
          <select
            name='months'
            className='border rounded px-2 py-1 text-sm'
            defaultValue={months}
            aria-label='Range (months)'
          >
            <option value={1}>Next 1 month</option>
            <option value={3}>Next 3 months</option>
            <option value={6}>Next 6 months</option>
          </select>
          <select
            name='jatha'
            className='border rounded px-2 py-1 text-sm'
            defaultValue={jatha}
          >
            <option value=''>All Jathas</option>
            <option value='A'>Jatha A</option>
            <option value='B'>Jatha B</option>
          </select>
          <select
            name='role'
            className='border rounded px-2 py-1 text-sm'
            defaultValue={role}
          >
            <option value=''>All Roles</option>
            <option value='KIRTAN'>Kirtan</option>
            <option value='PATH'>Path</option>
          </select>
          <input
            type='text'
            name='q'
            placeholder='Search name…'
            className='border rounded px-2 py-1 text-sm'
            defaultValue={q}
          />
          <button className='border rounded px-3 py-1 text-sm bg-gray-50 hover:bg-gray-100'>
            Apply
          </button>
        </form>
      </div>

      {/* Subheader: range + quick nav */}
      <div className='flex items-center justify-between gap-4 flex-wrap text-sm text-gray-700'>
        <div>
          Showing: {rangeLabel}
          {jatha ? ` · Jatha ${jatha}` : ''}
          {role ? ` · ${role}` : ''}
          {q ? ` · "${q}"` : ''}
        </div>
        <div className='flex items-center gap-2'>
          <Link
            className='border rounded px-3 py-1 text-sm bg-gray-50 hover:bg-gray-100'
            href={{
              pathname: '/admin/schedule',
              query: { from: prevFrom, months, jatha, role, q },
            }}
          >
            ← Prev {months} mo
          </Link>
          <Link
            className='border rounded px-3 py-1 text-sm bg-gray-50 hover:bg-gray-100'
            href={{
              pathname: '/admin/schedule',
              query: { from: nextFrom, months, jatha, role, q },
            }}
          >
            Next {months} mo →
          </Link>
        </div>
      </div>

      {/* Results */}
      {staff.length === 0 ? (
        <div className='text-sm text-gray-500'>
          No staff match the current filters.
        </div>
      ) : (
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
          {staff.map((s) => {
            const asgn = byStaff.get(s.id) ?? [];

            // Build month → assignments map for display
            const monthSections = monthsInRange.map((m) => {
              const mStart = startOfMonth(m);
              const mEnd = endOfMonth(m);
              const items = asgn.filter((a) => {
                const b = a.booking;
                const sStart = a.start ?? b.start;
                const sEnd = a.end ?? b.end;
                // overlap with this month
                return sStart < mEnd && sEnd > mStart;
              });
              return { month: m, items };
            });

            const totalCount = asgn.length;

            return (
              <div key={s.id} className='border rounded-xl p-4'>
                <div className='flex items-start justify-between mb-3'>
                  <div>
                    <div className='font-medium'>
                      {s.name}
                      {s.jatha ? ` · Jatha ${s.jatha}` : ''}
                    </div>
                    <div className='text-xs text-gray-500'>
                      {s.skills.join(', ')}
                    </div>
                    {(s.email || s.phone) && (
                      <div className='text-xs text-gray-500 mt-1 space-x-2'>
                        {s.email && <span>{s.email}</span>}
                        {s.phone && <span>· {s.phone}</span>}
                      </div>
                    )}
                  </div>
                  <a
                    href={`/api/staff/${s.id}/assignments.ics`}
                    className='text-xs underline hover:no-underline'
                  >
                    ICS
                  </a>
                </div>

                {totalCount ? (
                  <div className='space-y-3'>
                    {monthSections.map(({ month, items }) => {
                      if (!items.length) return null;
                      return (
                        <div key={month.toISOString()}>
                          <div className='text-xs font-semibold text-gray-700 mb-1'>
                            {fmtDate(month, 'MMMM yyyy')}
                          </div>
                          <ul className='space-y-2'>
                            {items.map((a) => {
                              const b = a.booking;
                              const it = a.bookingItem;
                              const roleLabel =
                                it.programType.category === 'PATH'
                                  ? 'Path'
                                  : it.programType.category === 'KIRTAN'
                                    ? 'Kirtan'
                                    : it.programType.category;
                              const loc = locLine(b as any);
                              const sStart = a.start ?? b.start;
                              const sEnd = a.end ?? b.end;
                              return (
                                <li key={a.id} className='rounded border p-2'>
                                  <div className='text-sm font-medium'>
                                    {b.title}
                                  </div>
                                  <div className='text-xs text-gray-600'>
                                    {fmtDate(sStart)} – {fmtDate(sEnd)}
                                  </div>
                                  <div className='text-xs'>{loc}</div>
                                  <div className='text-xs mt-0.5'>
                                    <b>{roleLabel}</b> — {it.programType.name}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className='text-sm text-gray-500'>
                    No assignments in this range.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
