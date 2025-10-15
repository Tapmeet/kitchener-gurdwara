// src/app/admin/bookings/parts.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ApproveButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'cancel' | null>(null);

  async function doPost(url: string, flag: 'approve' | 'cancel') {
    setBusy(flag);
    try {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        // try json, then text for clearer errors
        let msg = 'Request failed';
        try {
          const j = await res.json();
          msg = j?.error || msg;
        } catch {
          msg = (await res.text()) || msg;
        }
        alert(msg);
        return;
      }
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <div className='flex gap-2'>
      {/* IMPORTANT: call /approve (not /confirm) */}
      <button
        onClick={() => doPost(`/api/bookings/${id}/approve`, 'approve')}
        className='btn btn-primary btn-sm'
        disabled={busy !== null}
      >
        {busy === 'approve' ? 'Approving…' : 'Approve'}
      </button>

      {/* Keep cancel if you have this route; otherwise remove or add it (see below) */}
      <button
        onClick={() => doPost(`/api/bookings/${id}/cancel`, 'cancel')}
        className='btn btn-ghost btn-sm'
        disabled={busy !== null}
      >
        {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
      </button>
    </div>
  );
}
