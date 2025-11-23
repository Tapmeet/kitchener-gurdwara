// src/app/admin/bookings/parts.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ApproveButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'cancel' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function doPost(url: string, flag: 'approve' | 'cancel') {
    setBusy(flag);
    try {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
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
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const handleApprove = () => {
    // if we were in "confirm cancel" mode, reset it
    setConfirmCancel(false);
    doPost(`/api/bookings/${id}/confirm`, 'approve');
  };

  const handleCancel = () => {
    if (!confirmCancel) {
      // first click: just arm the confirmation
      setConfirmCancel(true);
      return;
    }
    // second click: actually cancel
    doPost(`/api/bookings/${id}/cancel`, 'cancel').finally(() =>
      setConfirmCancel(false)
    );
  };

  return (
    <div className='flex gap-2'>
      <button
        onClick={handleApprove}
        className='btn btn-primary btn-sm'
        disabled={busy !== null}
      >
        {busy === 'approve' ? 'Approving…' : 'Approve'}
      </button>

      <button
        onClick={handleCancel}
        className={
          confirmCancel ? 'btn btn-error btn-sm' : 'btn btn-ghost btn-sm'
        }
        disabled={busy !== null}
      >
        {busy === 'cancel'
          ? 'Cancelling…'
          : confirmCancel
            ? 'Confirm cancel'
            : 'Cancel'}
      </button>
    </div>
  );
}
