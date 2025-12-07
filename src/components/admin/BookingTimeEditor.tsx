// src/components/admin/BookingTimeEditor.tsx
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

  // 👉 Base duration derived from the original booking (program type / block hours)
  const baseStart =
    initialStart instanceof Date ? initialStart : new Date(initialStart);
  const baseEnd =
    initialEnd instanceof Date ? initialEnd : new Date(initialEnd);

  const rawDurationMs = baseEnd.getTime() - baseStart.getTime();
  // minimum 1 hour to avoid weird zero/negative durations
  const BASE_DURATION_MS = Math.max(rawDurationMs, 60 * 60 * 1000);

  const startParts = toDateHourParts(initialStart);
  const endParts = toDateHourParts(initialEnd);

  const [startDate, setStartDate] = useState<string>(startParts.date);
  const [startHour, setStartHour] = useState<string>(startParts.hour);
  const [endDate, setEndDate] = useState<string>(endParts.date);
  const [endHour, setEndHour] = useState<string>(endParts.hour);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Tracks if admin has manually edited the end fields
  const [endTouched, setEndTouched] = useState(false);

  const recomputeEndFrom = (dateStr: string, hourStr: string) => {
    if (!BASE_DURATION_MS) return;
    const start = new Date(`${dateStr}T${hourStr}:00`);
    if (isNaN(start.getTime())) return;

    const end = new Date(start.getTime() + BASE_DURATION_MS);
    const parts = toDateHourParts(end);
    setEndDate(parts.date);
    setEndHour(parts.hour);
  };

  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    setError(null);
    setOkMsg(null);

    // If admin hasn't manually touched End, auto-suggest based on program duration
    if (!endTouched) {
      recomputeEndFrom(value, startHour);
    }
  };

  const handleStartHourChange = (value: string) => {
    setStartHour(value);
    setError(null);
    setOkMsg(null);

    if (!endTouched) {
      recomputeEndFrom(startDate, value);
    }
  };

  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    setEndTouched(true);
    setError(null);
    setOkMsg(null);
  };

  const handleEndHourChange = (value: string) => {
    setEndHour(value);
    setEndTouched(true);
    setError(null);
    setOkMsg(null);
  };

  const onUpdate = () => {
    setError(null);
    setOkMsg(null);

    // Build real Date objects and send ISO strings
    const startIso = new Date(`${startDate}T${startHour}:00`).toISOString();
    const endIso = new Date(`${endDate}T${endHour}:00`).toISOString();

    startTransition(() => {
      (async () => {
        const res = await fetch(`/api/admin/bookings/${bookingId}`, {
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
        // Make Admin · Bookings + ReviewProposed refetch and show new assignments
        router.refresh();
      })();
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
            onChange={(e) => handleStartDateChange(e.target.value)}
            className='rounded border px-2 py-1 text-xs'
          />
        </div>

        <div className='space-y-1'>
          <div className='text-[11px] uppercase tracking-wide text-gray-500'>
            Start time
          </div>
          <select
            value={startHour}
            onChange={(e) => handleStartHourChange(e.target.value)}
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
            onChange={(e) => handleEndDateChange(e.target.value)}
            className='rounded border px-2 py-1 text-xs'
          />
        </div>

        <div className='space-y-1'>
          <div className='text-[11px] uppercase tracking-wide text-gray-500'>
            End time
          </div>
          <select
            value={endHour}
            onChange={(e) => handleEndHourChange(e.target.value)}
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

      {error && <div className='mt-1 text-[11px] text-red-600'>{error}</div>}
      {okMsg && !error && (
        <div className='mt-1 text-[11px] text-green-600'>{okMsg}</div>
      )}
    </div>
  );
}
