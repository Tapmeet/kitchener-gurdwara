// src/components/AssignmentsPanel.tsx
'use client';
import { useEffect, useState } from 'react';

type Shortage = { itemId: string; role: string; needed: number };

export default function AssignmentsPanel({ bookingId }: { bookingId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  // 🔴 new: store shortages returned by /auto-assign
  const [shortages, setShortages] = useState<Shortage[] | null>(null);

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
      setShortages(null); // clear old warning

      const r = await fetch(`/api/bookings/${bookingId}/auto-assign`, {
        method: 'POST',
      });
      const j = await r.json();

      if (j?.error) {
        alert(j.error);
      } else if (Array.isArray(j.shortages)) {
        // keep only real shortages (ignore FLEX + 0 needed)
        const hard: Shortage[] = j.shortages.filter(
          (s: any) => s && s.role !== 'FLEX' && s.needed > 0
        );
        setShortages(hard);
      }

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

  // 🔴 build human-readable lines from shortages + program names
  let shortageLines: string[] = [];
  if (shortages && shortages.length && data.items) {
    const nameByItem = new Map<string, string>();
    for (const item of data.items) {
      nameByItem.set(item.id, item.programType.name);
    }

    const grouped = new Map<string, Shortage[]>();
    for (const s of shortages) {
      if (!grouped.has(s.itemId)) grouped.set(s.itemId, []);
      grouped.get(s.itemId)!.push(s);
    }

    shortageLines = Array.from(grouped.entries()).map(([itemId, arr]) => {
      const name = nameByItem.get(itemId) ?? 'Program';
      const parts = arr.map((s) => {
        const label =
          s.role === 'KIRTAN'
            ? 'Kirtan sevadars'
            : s.role === 'PATH'
              ? 'Pathis'
              : s.role;
        return `${label} missing ${s.needed}`;
      });
      return `${name}: ${parts.join('; ')}`;
    });
  }

  return (
    <div className='space-y-4'>
      <h1 className='text-lg font-semibold'>Assignments</h1>
      <button
        onClick={autoAssign}
        disabled={posting}
        className='text-sm border rounded px-3 py-1 bg-gray-50 hover:bg-gray-100 disabled:opacity-50'
        title='Auto-assign kirtan/path (includes Akhand rotations)'
      >
        {posting ? 'Assigning…' : 'Auto-assign'}
      </button>

      {/* 🔴 shortage banner, only when auto-assign reports missing staff */}
      {shortageLines.length > 0 && (
        <div className='rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800'>
          <div className='font-semibold text-red-900'>
            Not enough staff could be auto-assigned.
          </div>
          <ul className='mt-1 list-disc pl-5'>
            {shortageLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className='mt-1 text-[11px] text-red-900/80'>
            Try changing the time or manually adjusting assignments before
            confirming this booking.
          </div>
        </div>
      )}

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
