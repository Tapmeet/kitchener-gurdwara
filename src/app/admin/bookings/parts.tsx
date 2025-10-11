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
        const j = await res.json().catch(() => ({}) as any);
        alert(j?.error || 'Request failed');
      }
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  return (
    <div className='flex gap-2'>
      <button
        onClick={() => doPost(`/api/bookings/${id}/confirm`, 'approve')}
        className='btn btn-primary btn-sm'
        disabled={busy !== null}
      >
        {busy === 'approve' ? 'Approving…' : 'Approve'}
      </button>
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
