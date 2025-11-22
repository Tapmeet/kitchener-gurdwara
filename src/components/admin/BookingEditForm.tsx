'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type BookingEditFormProps = {
  booking: {
    id: string;
    title: string;
    start: string; // ISO
    end: string; // ISO
    locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
    hallId: string | null;
    hallName: string | null;
    address: string | null;
    attendees: number;
    contactName: string;
    contactPhone: string;
    contactEmail: string | null;
    notes: string | null;
    status: string;
    programNames: string[];
    blockHours: number;
  };
  halls: { id: string; name: string }[];
};

type HourOption = { value: string; label: string };

// 7:00–20:00 in 1-hour steps
const HOUR_OPTIONS: HourOption[] = (() => {
  const out: HourOption[] = [];
  for (let h = 7; h <= 20; h++) {
    const dt = new Date();
    dt.setHours(h, 0, 0, 0);
    const label = dt.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    const value = `${String(h).padStart(2, '0')}:00`;
    out.push({ value, label });
  }
  return out;
})();

function toDateParts(iso: string) {
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10); // yyyy-mm-dd
  const time = `${String(d.getHours()).padStart(2, '0')}:00`; // hour-only
  return { date, time };
}

function combineDateAndTime(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

const BookingEditForm: React.FC<BookingEditFormProps> = ({
  booking,
  halls,
}) => {
  const router = useRouter();

  const initial = useMemo(() => {
    const s = toDateParts(booking.start);
    const e = toDateParts(booking.end);
    return {
      startDate: s.date,
      startTime: s.time,
      endDate: e.date,
      endTime: e.time,
    };
  }, [booking.start, booking.end]);

  const [title, setTitle] = useState(booking.title);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [attendees, setAttendees] = useState(booking.attendees);
  const [contactName, setContactName] = useState(booking.contactName);
  const [contactPhone, setContactPhone] = useState(booking.contactPhone);
  const [contactEmail, setContactEmail] = useState(booking.contactEmail ?? '');
  const [notes, setNotes] = useState(booking.notes ?? '');
  const [hallId, setHallId] = useState<string>(booking.hallId ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { blockHours } = booking;

  // Auto-adjust end when start changes, based on blockHours
  function autoAdjustEnd(newStartDate: string, newStartTime: string) {
    if (!newStartDate || !newStartTime || !blockHours) return;

    const base = new Date(`${newStartDate}T${newStartTime}:00`);
    if (Number.isNaN(base.getTime())) return;

    base.setHours(base.getHours() + blockHours);

    const newEndDate = base.toISOString().slice(0, 10);
    const newEndTime = `${String(base.getHours()).padStart(2, '0')}:00`;

    setEndDate(newEndDate);
    setEndTime(newEndTime);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (!startDate || !startTime || !endDate || !endTime) {
      setError('Please select both start and end date/time.');
      return;
    }

    const startIso = combineDateAndTime(startDate, startTime);
    const endIso = combineDateAndTime(endDate, endTime);

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          start: startIso,
          end: endIso,
          attendees,
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
          contactEmail: contactEmail.trim() || null,
          notes,
          hallId: booking.locationType === 'GURDWARA' ? hallId || null : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data?.error ||
            'Failed to save booking. Please check times and try again.'
        );
      } else {
        setSaved(true);
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      setError('Unexpected error while saving booking.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-6'>
      <div className='rounded-xl border p-4 bg-white space-y-4'>
        {/* Basic info */}
        <div>
          <label className='block text-sm font-medium text-gray-700'>
            Title
          </label>
          <input
            className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* When */}
        <div>
          <div className='text-sm font-medium text-gray-700 mb-1'>When</div>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <div>
              <label className='block text-xs text-gray-500 mb-1'>
                Start date
              </label>
              <input
                type='date'
                className='block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
                value={startDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setStartDate(v);
                  autoAdjustEnd(v, startTime); // ⬅️ adjust end
                }}
              />
              <label className='block text-xs text-gray-500 mt-2 mb-1'>
                Start time (hour only)
              </label>
              <select
                className='block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
                value={startTime}
                onChange={(e) => {
                  const v = e.target.value;
                  setStartTime(v);
                  autoAdjustEnd(startDate, v); // ⬅️ adjust end
                }}
              >
                {HOUR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className='block text-xs text-gray-500 mb-1'>
                End date
              </label>
              <input
                type='date'
                className='block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <label className='block text-xs text-gray-500 mt-2 mb-1'>
                End time (hour only)
              </label>
              <select
                className='block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              >
                {HOUR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className='mt-1 text-[11px] text-gray-500'>
            End date/time auto-fills from the program length (≈
            {booking.blockHours} hour
            {booking.blockHours > 1 ? 's' : ''}) when you change the start.
          </p>
        </div>

        {/* Location / hall (admin-editable) */}
        <div>
          <div className='text-sm font-medium text-gray-700 mb-1'>
            Location / hall
          </div>

          {booking.locationType === 'GURDWARA' ? (
            <div className='space-y-1 text-sm'>
              <label className='block text-xs text-gray-500 mb-1'>
                Hall at the Gurdwara
              </label>
              <select
                className='block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
                value={hallId}
                onChange={(e) => setHallId(e.target.value)}
              >
                <option value=''>Auto / unspecified hall</option>
                {halls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <p className='mt-1 text-xs text-gray-500'>
                Changing the hall does not re-run auto-picking; make sure the
                new hall is free and suitable.
              </p>
            </div>
          ) : (
            <div className='text-xs text-gray-500'>
              Outside booking – address:{' '}
              <span className='font-medium'>
                {booking.address || 'Not specified'}
              </span>
            </div>
          )}
        </div>

        {/* Attendees */}
        <div>
          <label className='block text-sm font-medium text-gray-700'>
            Attendees
          </label>
          <input
            type='number'
            min={1}
            className='mt-1 block w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
            value={attendees}
            onChange={(e) => setAttendees(Number(e.target.value) || 1)}
          />
        </div>

        {/* Contact */}
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='block text-sm font-medium text-gray-700'>
              Contact name
            </label>
            <input
              className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>
          <div>
            <label className='block text-sm font-medium text-gray-700'>
              Contact phone
            </label>
            <input
              className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className='block text-sm font-medium text-gray-700'>
            Contact email
          </label>
          <input
            type='email'
            className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>

        {/* Notes */}
        <div>
          <label className='block text-sm font-medium text-gray-700'>
            Notes
          </label>
          <textarea
            className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {/* Read-only info */}
        <div className='border-t pt-3 mt-2 text-xs text-gray-500 space-y-1'>
          <div>
            <b>Programs:</b> {booking.programNames.join(', ')}
          </div>
          <div>
            <b>Status:</b> {booking.status}
          </div>
        </div>
      </div>

      {/* Footer / actions */}
      <div className='flex items-center gap-3'>
        <button
          type='submit'
          disabled={saving}
          className='inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed'
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>

        {saved && !error && (
          <span className='text-xs text-green-700'>
            Changes saved and (if enabled) email sent to customer.
          </span>
        )}
        {error && <span className='text-xs text-red-600'>{error}</span>}
      </div>
    </form>
  );
};

export default BookingEditForm;
