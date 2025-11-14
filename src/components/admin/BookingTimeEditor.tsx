'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BUSINESS_HOURS_24 } from '@/lib/businessHours';

type Props = {
  bookingId: string;
  initialStart: Date | string;
  initialEnd: Date | string;
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function toDateHourParts(d: Date | string) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = pad2(dt.getMonth() + 1);
  const day = pad2(dt.getDate());
  const h = pad2(dt.getHours()); // ignore minutes
  return {
    date: `${y}-${m}-${day}`, // YYYY-MM-DD
    hour: h, // "07", "18", etc
  };
}

function hourLabel(h: number) {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hr12 = h % 12 || 12;
  return `${hr12}:00 ${suffix}`;
}

export default function BookingTimeEditor({
  bookingId,
  initialStart,
  initialEnd,
}: Props) {
  const router = useRouter();
  const startParts = toDateHourParts(initialStart);
  const endParts = toDateHourParts(initialEnd);

  const [startDate, setStartDate] = useState(startParts.date);
  const [startHour, setStartHour] = useState(startParts.hour);
  const [endDate, setEndDate] = useState(endParts.date);
  const [endHour, setEndHour] = useState(endParts.hour);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const onUpdate = () => {
    setError(null);
    setOkMsg(null);

    const startIso = `${startDate}T${startHour}:00`;
    const endIso = `${endDate}T${endHour}:00`;

    startTransition(async () => {
      const res = await fetch(`/api/admin/bookings/${bookingId}/time`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: startIso, end: endIso }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || 'Failed to update booking time.');
        return;
      }

      setOkMsg('Time updated.');
      router.refresh();
    });
  };

  return (
    <div className='mt-3 space-y-2'>
      <div className='text-xs font-semibold text-gray-600'>Adjust time</div>

      <div className='flex flex-wrap items-end gap-2 text-xs'>
        {/* Start date + hour */}
        <div className='space-y-1'>
          <div className='text-[11px] uppercase tracking-wide text-gray-500'>
            Start date
          </div>
          <input
            type='date'
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className='rounded border px-2 py-1 text-xs'
          />
        </div>

        <div className='space-y-1'>
          <div className='text-[11px] uppercase tracking-wide text-gray-500'>
            Start time
          </div>
          <select
            value={startHour}
            onChange={(e) => setStartHour(e.target.value)}
            className='rounded border px-2 py-1 text-xs'
          >
            {BUSINESS_HOURS_24.map((h) => (
              <option key={h} value={pad2(h)}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </div>

        {/* End date + hour */}
        <div className='space-y-1'>
          <div className='text-[11px] uppercase tracking-wide text-gray-500'>
            End date
          </div>
          <input
            type='date'
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className='rounded border px-2 py-1 text-xs'
          />
        </div>

        <div className='space-y-1'>
          <div className='text-[11px] uppercase tracking-wide text-gray-500'>
            End time
          </div>
          <select
            value={endHour}
            onChange={(e) => setEndHour(e.target.value)}
            className='rounded border px-2 py-1 text-xs'
          >
            {BUSINESS_HOURS_24.map((h) => (
              <option key={h} value={pad2(h)}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </div>

        {/* Button styled like Approve */}
        <button
          type='button'
          onClick={onUpdate}
          disabled={isPending}
          className='inline-flex items-center justify-center rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed'
        >
          {isPending ? 'Updating…' : 'Update time'}
        </button>
      </div>

      {error && <div className='text-[11px] text-red-600 mt-1'>{error}</div>}
      {okMsg && !error && (
        <div className='text-[11px] text-green-600 mt-1'>{okMsg}</div>
      )}
    </div>
  );
}
