// src/components/admin/BookingEditForm.tsx
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
    programTypeIds: string[];
    blockHours: number;
  };
  halls: { id: string; name: string }[];
  programTypes: { id: string; name: string }[];
};

type TimeOption = { value: string; label: string };

// 7:00–20:30 in 30-minute steps
const TIME_OPTIONS: TimeOption[] = (() => {
  const out: TimeOption[] = [];
  for (let h = 7; h <= 20; h++) {
    for (const m of [0, 30]) {
      const hour12 = ((h + 11) % 12) + 1; // 0->12, 13->1, etc.
      const suffix = h < 12 ? 'AM' : 'PM';
      const minStr = m === 0 ? '00' : '30';
      const label = `${hour12}:${minStr} ${suffix}`;
      const value = `${String(h).padStart(2, '0')}:${minStr}`;
      out.push({ value, label });
    }
  }
  return out;
})();

function toDateParts(iso: string) {
  const d = new Date(iso);
  const date = d.toISOString().slice(0, 10); // yyyy-mm-dd

  // keep minutes, but snap to 0 or 30 just in case
  const mins = d.getMinutes();
  const snapped = mins >= 30 ? 30 : 0;
  const time = `${String(d.getHours()).padStart(2, '0')}:${snapped
    .toString()
    .padStart(2, '0')}`;

  return { date, time };
}

function combineDateAndTime(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

const BookingEditForm: React.FC<BookingEditFormProps> = ({
  booking,
  halls,
  programTypes,
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

  const [locationType, setLocationType] = useState<
    'GURDWARA' | 'OUTSIDE_GURDWARA'
  >(booking.locationType);

  const [address, setAddress] = useState(booking.address ?? '');

  const [selectedProgram, setSelectedProgram] = useState<string>(
    booking.programTypeIds?.[0] ?? ''
  );

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

    if (!selectedProgram) {
      setError('Please select a program.');
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
          locationType,
          address:
            locationType === 'OUTSIDE_GURDWARA' ? address.trim() || null : null,
          hallId: locationType === 'GURDWARA' ? hallId || null : null,
          programTypeIds: [selectedProgram],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data?.error ||
            'Failed to save booking. Please check times and try again.'
        );
      } else {
        await res.json().catch(() => ({}));
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

  // Derive current program name from selection
  const selectedProgramName =
    programTypes.find((pt) => pt.id === selectedProgram)?.name ?? null;

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
                  autoAdjustEnd(v, startTime);
                }}
              />
              <label className='block text-xs text-gray-500 mt-2 mb-1'>
                Start time
              </label>
              <select
                className='block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
                value={startTime}
                onChange={(e) => {
                  const v = e.target.value;
                  setStartTime(v);
                  autoAdjustEnd(startDate, v);
                }}
              >
                {TIME_OPTIONS.map((opt) => (
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
                End time
              </label>
              <select
                className='block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              >
                {TIME_OPTIONS.map((opt) => (
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
          <div className='text-sm font-medium text-gray-700 mb-1'>Location</div>

          {/* Toggle between Gurdwara / Outside */}
          <div className='flex flex-wrap gap-4 mb-2 text-sm'>
            <label className='flex items-center gap-2'>
              <input
                type='radio'
                name='locationType'
                value='GURDWARA'
                checked={locationType === 'GURDWARA'}
                onChange={() => {
                  setLocationType('GURDWARA');
                }}
              />
              <span>At the Gurdwara</span>
            </label>
            <label className='flex items-center gap-2'>
              <input
                type='radio'
                name='locationType'
                value='OUTSIDE_GURDWARA'
                checked={locationType === 'OUTSIDE_GURDWARA'}
                onChange={() => {
                  setLocationType('OUTSIDE_GURDWARA');
                  // hall doesn't apply outside
                  setHallId('');
                }}
              />
              <span>Outside Gurdwara</span>
            </label>
          </div>

          {locationType === 'GURDWARA' ? (
            <div className='space-y-1 text-sm'>
              <label className='block text-xs text-gray-500 mb-1'>
                Hall at the Gurdwara
              </label>
              <select
                className='block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500 bg-white'
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
                Changing the hall or location does not re-run auto-picking; make
                sure the new hall is free and suitable.
              </p>
            </div>
          ) : (
            <div className='space-y-1 text-sm'>
              <label className='block text-xs text-gray-500 mb-1'>
                Outside address
              </label>
              <input
                type='text'
                className='mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500'
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder='Street, city, etc.'
              />
              <p className='mt-1 text-xs text-gray-500'>
                Outside bookings do not use a hall; travel time and buffers
                still apply.
              </p>
            </div>
          )}
        </div>

        {/* Program (admin-editable, single-select) */}
        <div>
          <div className='text-sm font-medium text-gray-700 mb-1'>Program</div>
          <div className='space-y-1 text-sm'>
            {programTypes.map((pt) => (
              <label key={pt.id} className='flex items-center gap-2'>
                <input
                  type='radio'
                  name='programType'
                  className='border-gray-300'
                  checked={selectedProgram === pt.id}
                  onChange={() => setSelectedProgram(pt.id)}
                />
                <span>{pt.name}</span>
              </label>
            ))}
          </div>
          <p className='mt-1 text-xs text-gray-500'>
            Changing the program will reset this booking back to <b>Pending</b>{' '}
            and clear all staff assignments. Re-approve it from the admin
            bookings page to regenerate staffing.
          </p>
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
            <b>Program:</b>{' '}
            {selectedProgramName ? selectedProgramName : 'None selected'}
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
