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

export function CancelBookingButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    const ok = window.confirm(
      'Are you sure you want to cancel this booking? This will mark the booking as CANCELLED.'
    );
    if (!ok) return;

    try {
      setBusy(true);

      const res = await fetch(`/api/bookings/${id}/cancel`, {
        method: 'POST',
      });

      if (!res.ok) {
        // try to show a useful error if API returned one
        let message = 'Failed to cancel booking.';
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // ignore JSON parse errors
        }
        alert(message);
        return;
      }

      // refresh the Admin · Bookings page so status + filters update
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type='button'
      onClick={handleClick}
      disabled={busy}
      className='text-s text-red-600 text-left underline hover:no-underline hover:text-red-700 disabled:opacity-60'
    >
      {busy ? 'Cancelling…' : 'Cancel booking'}
    </button>
  );
}
