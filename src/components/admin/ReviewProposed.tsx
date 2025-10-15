'use client';

import { useEffect, useState, useTransition } from 'react';

type Staff = {
  id: string;
  name: string;
  jatha: 'A' | 'B' | null;
  skills: string[];
};
type Row = {
  id: string;
  program: string;
  roleCategory: 'PATH' | 'KIRTAN' | 'OTHER';
  start: string;
  end: string;
  currentStaff: Staff;
  candidates: Staff[];
};

export default function ReviewProposed({ bookingId }: { bookingId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/bookings/${bookingId}/proposed-assignments`, {
      cache: 'no-store',
    });
    const data = await res.json();
    setRows(data.assignments || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [bookingId]);

  async function saveOne(id: string, staffId: string) {
    setSavingId(id);
    try {
      await fetch(`/api/assignments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId }),
      });
      await load(); // refresh the list so availability updates
    } finally {
      setSavingId(null);
    }
  }

  async function approveAll() {
    await fetch(`/api/bookings/${bookingId}/approve`, { method: 'POST' });
    // best-effort refresh the page
    startTransition(() => {
      location.reload();
    });
  }

  if (loading)
    return (
      <div className='text-sm text-gray-500'>Loading proposed assignments…</div>
    );
  if (!rows.length)
    return (
      <div className='text-sm text-gray-500'>No proposed assignments.</div>
    );

  return (
    <div className='mt-3 space-y-3'>
      {rows.map((r) => (
        <div
          key={r.id}
          className='flex flex-wrap items-center gap-2 border rounded p-2'
        >
          <div className='text-sm font-medium'>
            {r.program}
            <span className='ml-1 text-xs text-gray-500'>
              ({new Date(r.start).toLocaleString()} –{' '}
              {new Date(r.end).toLocaleString()})
            </span>
          </div>

          <div className='ml-auto flex items-center gap-2'>
            <select
              defaultValue={r.currentStaff.id}
              onChange={(e) => saveOne(r.id, e.target.value)}
              className='border rounded px-2 py-1 text-sm min-w-[14rem]'
              disabled={savingId === r.id}
              aria-label='Swap staff'
            >
              {/* Current first */}
              <option key={r.currentStaff.id} value={r.currentStaff.id}>
                {r.currentStaff.name}{' '}
                {r.currentStaff.jatha ? `· ${r.currentStaff.jatha}` : ''} · [
                {r.currentStaff.skills.join(', ')}]
              </option>
              {/* Eligible candidates */}
              {r.candidates
                .filter((c) => c.id !== r.currentStaff.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.jatha ? `· ${c.jatha}` : ''} · [
                    {c.skills.join(', ')}]
                  </option>
                ))}
            </select>
          </div>
        </div>
      ))}

      <div className='pt-2'>
        <button
          onClick={approveAll}
          className='px-4 py-2 bg-blue-600 text-white rounded'
          disabled={isPending}
        >
          Approve
        </button>
      </div>
    </div>
  );
}
