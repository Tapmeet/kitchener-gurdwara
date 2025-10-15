// src/components/admin/SwapAssignmentsClient.tsx
'use client';

import { useState } from 'react';

export default function SwapAssignmentsClient({
  bookingId,
}: {
  bookingId: string;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const A = a.trim();
    const B = b.trim();
    if (!A || !B || A === B) {
      setError('Enter two different assignment IDs.');
      return;
    }
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/assignments/swap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId, a: A, b: B }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Swap failed');
      } else {
        setMsg('Swap successful.');
        setA('');
        setB('');
      }
    } catch {
      setError('Network or server error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className='space-y-3 max-w-xl border rounded-2xl p-4'
    >
      <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
        <label className='flex flex-col gap-1'>
          <span className='text-sm'>Assignment A ID</span>
          <input
            value={a}
            onChange={(e) => setA(e.target.value)}
            placeholder='e.g. clx... (assignment id)'
            className='border rounded-xl px-3 py-2'
            required
          />
        </label>
        <label className='flex flex-col gap-1'>
          <span className='text-sm'>Assignment B ID</span>
          <input
            value={b}
            onChange={(e) => setB(e.target.value)}
            placeholder='e.g. clx... (assignment id)'
            className='border rounded-xl px-3 py-2'
            required
          />
        </label>
      </div>
      <div className='flex items-center gap-3'>
        <button
          type='submit'
          disabled={busy || !a.trim() || !b.trim() || a.trim() === b.trim()}
          className='px-4 py-2 rounded-2xl border shadow-sm disabled:opacity-50'
        >
          {busy ? 'Swapping...' : 'Swap'}
        </button>
        {msg && <span className='text-green-700 text-sm'>{msg}</span>}
        {error && <span className='text-red-700 text-sm'>{error}</span>}
      </div>
      <p className='text-xs text-gray-500'>
        Tip: if both IDs are the same time slot (same start/end & item), use the
        per-row dropdown on the review screen instead of swap, to avoid
        unique-key conflicts.
      </p>
    </form>
  );
}
