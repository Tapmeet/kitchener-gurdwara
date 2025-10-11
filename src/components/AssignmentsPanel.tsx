'use client';
import { useEffect, useState } from 'react';

export default function AssignmentsPanel({ bookingId }: { bookingId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const refresh = () => {
    setLoading(true);
    setErr(null);
    return fetch(`/api/bookings/${bookingId}/assignments`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.error) setErr(j.error);
        else setData(j);
      })
      .catch(() => setErr('Failed to load assignments'))
      .finally(() => setLoading(false));
  };

  async function autoAssign() {
    try {
      setPosting(true);
      const r = await fetch(`/api/bookings/${bookingId}/auto-assign`, {
        method: 'POST',
      });
      const j = await r.json();
      if (j?.error) alert(j.error);
      await refresh();
    } finally {
      setPosting(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setErr(null);
    fetch(`/api/bookings/${bookingId}/assignments`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.error) setErr(j.error);
        else setData(j);
      })
      .catch(() => setErr('Failed to load assignments'))
      .finally(() => setLoading(false));
  }, [bookingId]);

  if (loading)
    return <p className='text-sm text-gray-500'>Loading assignments…</p>;
  if (err) return <div className='alert alert-error'>{err}</div>;
  if (!data) return null;

  return (
    <div className='space-y-4'>
      <h2 className='text-lg font-semibold'>Assignments</h2>
      <button
        onClick={autoAssign}
        disabled={posting}
        className='text-sm border rounded px-3 py-1 bg-gray-50 hover:bg-gray-100 disabled:opacity-50'
        title='Auto-assign kirtan/path (includes Akhand rotations)'
      >
        {posting ? 'Assigning…' : 'Auto-assign'}
      </button>
      {data.items.map((item: any) => (
        <div key={item.id} className='rounded-xl border border-black/10 p-3'>
          <div className='font-medium'>
            {item.programType.name}{' '}
            <span className='text-xs text-gray-500'>
              ({item.programType.category})
            </span>
          </div>
          {item.assignments.length === 0 ? (
            <p className='text-xs text-gray-500 mt-1'>No staff assigned.</p>
          ) : (
            <ul className='mt-2 divide-y divide-black/5'>
              {item.assignments.map((a: any) => (
                <li
                  key={a.id}
                  className='py-1.5 text-sm flex items-center justify-between'
                >
                  <span>{a.staff.name}</span>
                  <span className='text-xs text-gray-500'>
                    [{a.staff.skills.join(', ')}]
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
