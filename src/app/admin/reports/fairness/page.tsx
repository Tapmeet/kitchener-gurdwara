// src/app/admin/reports/fairness/page.tsx
import { auth } from '@/lib/auth';
import {
  buildFairnessReport,
  type Role,
  type Jatha,
} from '@/lib/report-fairness';
import { format } from 'date-fns';
import Link from 'next/link';

function isAdminRole(role?: string | null) {
  return role === 'ADMIN';
}

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type SortKey = '' | 'windowCredits' | 'lifetimeCredits' | 'name' | 'jatha';
type SortDir = 'asc' | 'desc';

export default async function Page({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user || !isAdminRole((session.user as any).role)) {
    return <div className='p-6'>Unauthorized (admin/secretary only).</div>;
  }

  const params = (searchParams ? await searchParams : {}) as Record<
    string,
    string | string[] | undefined
  >;

  const windowWeeks = Number(params.windowWeeks ?? 8);

  const role = (typeof params.role === 'string' ? params.role : '') as
    | Role
    | '';
  const jatha = (typeof params.jatha === 'string' ? params.jatha : '') as
    | Jatha
    | '';

  const qRaw =
    typeof params.q === 'string'
      ? params.q
      : Array.isArray(params.q)
        ? params.q[0]
        : '';
  const q = (qRaw?.trim() ?? '') || '';

  const sort = (typeof params.sort === 'string' ? params.sort : '') as SortKey;
  const dirParam = typeof params.dir === 'string' ? params.dir : '';
  const dir: SortDir = dirParam === 'asc' ? 'asc' : 'desc';

  const { rows, windowStart, windowEnd } = await buildFairnessReport({
    windowWeeks,
    role,
    jatha,
    q,
  });

  // Basic stats for summary
  const staffCount = rows.length;
  const totalWindowCredits = rows.reduce((sum, r) => sum + r.creditsWindow, 0);
  const totalLifetimeCredits = rows.reduce((sum, r) => sum + r.creditsTotal, 0);
  const avgWindowCredits =
    staffCount > 0 ? Math.round(totalWindowCredits / staffCount) : 0;
  const avgLifetimeCredits =
    staffCount > 0 ? Math.round(totalLifetimeCredits / staffCount) : 0;

  // Jatha-level summary
  const jathaTotals = ['A', 'B'].map((j) => {
    const subset = rows.filter((r) => r.jatha === (j as Jatha));
    const staffCountJ = subset.length;
    const windowTotalJ = subset.reduce((sum, r) => sum + r.creditsWindow, 0);
    const lifetimeTotalJ = subset.reduce((sum, r) => sum + r.creditsTotal, 0);
    const avgWindowJ =
      staffCountJ > 0 ? Math.round(windowTotalJ / staffCountJ) : 0;
    const avgLifetimeJ =
      staffCountJ > 0 ? Math.round(lifetimeTotalJ / staffCountJ) : 0;

    return {
      jatha: j,
      staffCount: staffCountJ,
      windowTotal: windowTotalJ,
      lifetimeTotal: lifetimeTotalJ,
      avgWindow: avgWindowJ,
      avgLifetime: avgLifetimeJ,
    };
  });

  // Optional sorting (defaults to backend order if no sort key)
  const sortedRows = sort
    ? [...rows].sort((a, b) => {
        const mul = dir === 'asc' ? 1 : -1;
        switch (sort) {
          case 'windowCredits':
            return (a.creditsWindow - b.creditsWindow) * mul;
          case 'lifetimeCredits':
            return (a.creditsTotal - b.creditsTotal) * mul;
          case 'name':
            return a.name.localeCompare(b.name) * mul;
          case 'jatha':
            return (a.jatha || '').localeCompare(b.jatha || '') * mul;
          default:
            return 0;
        }
      })
    : rows;

  const csvHref =
    '/api/admin/reports/fairness?' +
    new URLSearchParams({
      windowWeeks: String(windowWeeks),
      role,
      jatha,
      q,
      sort,
      dir,
    }).toString();

  const buildHref = (overrides: Partial<Record<string, string>>) => {
    const base: Record<string, string> = {
      windowWeeks: String(windowWeeks || 8),
      role,
      jatha,
      q,
    };
    if (sort) base.sort = sort;
    if (dir) base.dir = dir;

    for (const [k, v] of Object.entries(overrides)) {
      if (!v) {
        delete base[k];
      } else {
        base[k] = v;
      }
    }

    const sp = new URLSearchParams(base);
    return `/admin/reports/fairness?${sp.toString()}`;
  };

  const nextDir = (key: SortKey): SortDir =>
    sort === key && dir === 'desc' ? 'asc' : 'desc';

  return (
    <div className='p-6 space-y-6'>
      <div className='flex items-center justify-between gap-4 flex-wrap'>
        <h1 className='text-xl font-semibold'>Fairness Report</h1>

        {/* Filters */}
        <form
          className='flex items-end gap-2 flex-wrap text-sm'
          action='/admin/reports/fairness'
          method='get'
        >
          <label className='flex flex-col'>
            <span className='text-xs text-gray-600 mb-1'>Window (weeks)</span>
            <input
              type='number'
              name='windowWeeks'
              className='border rounded px-2 py-1 w-24'
              min={1}
              defaultValue={windowWeeks || 8}
            />
          </label>

          <label className='flex flex-col'>
            <span className='text-xs text-gray-600 mb-1'>Role</span>
            <select
              name='role'
              className='border rounded px-2 py-1'
              defaultValue={role}
            >
              <option value=''>All Roles</option>
              <option value='KIRTAN'>Kirtan</option>
              <option value='PATH'>Path</option>
            </select>
          </label>

          <label className='flex flex-col'>
            <span className='text-xs text-gray-600 mb-1'>Jatha</span>
            <select
              name='jatha'
              className='border rounded px-2 py-1'
              defaultValue={jatha}
            >
              <option value=''>All Jathas</option>
              <option value='A'>Jatha A</option>
              <option value='B'>Jatha B</option>
            </select>
          </label>

          <label className='flex flex-col'>
            <span className='text-xs text-gray-600 mb-1'>Search</span>
            <input
              type='text'
              name='q'
              placeholder='Search name…'
              className='border rounded px-2 py-1'
              defaultValue={q}
            />
          </label>

          {/* Preserve sort/dir when filtering */}
          {sort && <input type='hidden' name='sort' value={sort} />}
          <input type='hidden' name='dir' value={dir} />

          <button className='border rounded px-3 py-1 bg-gray-50 hover:bg-gray-100'>
            Filter
          </button>

          <Link
            href='/admin/reports/fairness'
            className='text-xs text-gray-600 underline hover:no-underline ml-2'
          >
            Reset
          </Link>
        </form>
      </div>

      {/* Window + summary */}
      <div className='flex flex-wrap items-center justify-between gap-3 text-sm text-gray-700'>
        <div>
          Window: {format(windowStart, 'MMM d, yyyy')} –{' '}
          {format(windowEnd, 'MMM d, yyyy')} · {windowWeeks || 8} weeks
          {role ? <> · {role}</> : null}
          {jatha ? <> · Jatha {jatha}</> : null}
          {q ? <> · &quot;{q}&quot;</> : null}
          <span className='ml-3'>
            <a className='underline hover:no-underline' href={csvHref}>
              Export CSV
            </a>
          </span>
        </div>

        <div className='text-xs text-gray-600 flex flex-wrap gap-4'>
          <span>Staff: {staffCount}</span>
          <span>
            Window credits: total {totalWindowCredits} · avg {avgWindowCredits}
          </span>
          <span>
            Lifetime credits: total {totalLifetimeCredits} · avg{' '}
            {avgLifetimeCredits}
          </span>
        </div>
      </div>

      <div className='overflow-auto rounded border'>
        <table className='min-w-full text-sm'>
          <thead className='bg-gray-50 border-b'>
            <tr>
              <th className='text-left p-2'>
                <Link
                  href={buildHref({
                    sort: 'name',
                    dir: nextDir('name'),
                  })}
                >
                  Staff
                  {sort === 'name' ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </Link>
              </th>
              <th className='text-left p-2'>
                <Link
                  href={buildHref({
                    sort: 'jatha',
                    dir: nextDir('jatha'),
                  })}
                >
                  Jatha
                  {sort === 'jatha' ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </Link>
              </th>
              <th className='text-left p-2'>Skills</th>
              <th className='text-right p-2'>
                <Link
                  href={buildHref({
                    sort: 'windowCredits',
                    dir: nextDir('windowCredits'),
                  })}
                >
                  Window Credits
                  {sort === 'windowCredits'
                    ? dir === 'asc'
                      ? ' ↑'
                      : ' ↓'
                    : ''}
                </Link>
              </th>
              <th className='text-right p-2'>
                <Link
                  href={buildHref({
                    sort: 'lifetimeCredits',
                    dir: nextDir('lifetimeCredits'),
                  })}
                >
                  Lifetime Credits
                  {sort === 'lifetimeCredits'
                    ? dir === 'asc'
                      ? ' ↑'
                      : ' ↓'
                    : ''}
                </Link>
              </th>
              <th className='text-left p-2'>Programs (all)</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.staffId} className='border-b align-top'>
                <td className='p-2'>
                  <div className='font-medium'>{r.name}</div>
                  <div className='text-xs text-gray-500'>
                    {r.email || r.phone || '—'}
                  </div>
                </td>
                <td className='p-2'>{r.jatha ? `Jatha ${r.jatha}` : '—'}</td>
                <td className='p-2'>{r.skills.join(', ')}</td>
                <td className='p-2 text-right'>{r.creditsWindow}</td>
                <td className='p-2 text-right'>{r.creditsTotal}</td>
                <td className='p-2'>
                  {r.programs.length ? (
                    <div className='max-h-40 overflow-y-auto pr-1'>
                      <ul className='space-y-1'>
                        {r.programs.map((p) => (
                          <li key={p.programId} className='text-xs'>
                            <b>{p.name}</b> ({p.category}) · w:{p.weight} ·{' '}
                            {p.countWindow}/{p.countTotal} asg · cw:
                            {p.creditsWindow}/ct:{p.creditsTotal}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <span className='text-xs text-gray-500'>
                      No assignments
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className='text-xs text-gray-600 flex flex-wrap gap-4'>
        <span>Staff: {staffCount}</span>
        <span>
          Window credits: total {totalWindowCredits} · avg {avgWindowCredits}
        </span>
        <span>
          Lifetime credits: total {totalLifetimeCredits} · avg{' '}
          {avgLifetimeCredits}
        </span>

        {jathaTotals.map((j) => (
          <span key={j.jatha}>
            Jatha {j.jatha}: window {j.windowTotal} (avg {j.avgWindow}) ·
            lifetime {j.lifetimeTotal} (avg {j.avgLifetime})
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className='text-sm text-gray-500'>
          No staff or no data for the selected filters.
        </div>
      ) : null}
    </div>
  );
}
