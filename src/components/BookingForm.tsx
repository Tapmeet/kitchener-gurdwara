'use client';
import { useEffect, useMemo, useState } from 'react';
import { CreateBookingSchema } from '@/lib/validation';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { useRouter } from 'next/navigation';
import { formatPhoneLive, toE164Generic } from '@/lib/phone';

/* ---------- types ---------- */
type LocationType = '' | 'GURDWARA' | 'OUTSIDE_GURDWARA';
type ProgramCategory = 'KIRTAN' | 'PATH' | 'OTHER';

interface ProgramType {
  id: string;
  name: string;
  category: ProgramCategory;
  durationMinutes: number;
}

interface Hall {
  id: string;
  name: string;
  capacity?: number | null;
}

/* ---------- helpers ---------- */
function todayLocalDateString() {
  return toLocalDateString(new Date());
}
/** First selectable hour for a given date string (YYYY-MM-DD). */
function minSelectableHour24(dateStr: string): number {
  const base = 7; // business day starts at 7
  if (dateStr !== todayLocalDateString()) return base;
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const nextHour = h + (m > 0 ? 1 : 0);
  return Math.max(base, nextHour);
}
function toLocalDateString(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toISOFromLocalDateHour(dateStr: string, hour24: number) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const local = new Date(y, (m ?? 1) - 1, d ?? 1, hour24, 0, 0, 0);
  return local.toISOString();
}
function to12(h24: number): { h12: number; ap: 'AM' | 'PM' } {
  const ap: 'AM' | 'PM' = h24 < 12 ? 'AM' : 'PM';
  const h = h24 % 12;
  return { h12: h === 0 ? 12 : h, ap };
}

// 7:00 → 19:00 inclusive
const BUSINESS_HOURS_24 = Array.from({ length: 13 }, (_, i) => i + 7); // 7..19

/** Intersect business hours with server-available hours (fallback to business hours if server empty). */
function visibleStartHours(
  serverAvailableHours: number[] | null | undefined
): number[] {
  if (Array.isArray(serverAvailableHours) && serverAvailableHours.length > 0) {
    const s = new Set(serverAvailableHours);
    return BUSINESS_HOURS_24.filter((h) => s.has(h));
  }
  return BUSINESS_HOURS_24;
}

/* ---------- component ---------- */

export default function BookingForm() {
  const router = useRouter();
  const [programTypes, setProgramTypes] = useState<ProgramType[]>([]);
  const [halls, setHalls] = useState<Hall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState<string>('');
  const [locationType, setLocationType] = useState<LocationType>('');

  // Date + time
  const now = useMemo(() => new Date(), []);
  const [date, setDate] = useState(toLocalDateString(now));

  // Single 24h start time within 7–19
  const initialStartHour24 = (() => {
    const h = now.getHours();
    if (h < 7 || h > 19) return 7;
    return h;
  })();
  const [startHour24, setStartHour24] = useState<number>(initialStartHour24);

  // Program: SINGLE-SELECT
  const [selectedProgramId, setSelectedProgramId] = useState<string>('');
  const selectedProgram = useMemo(
    () => programTypes.find((p) => p.id === selectedProgramId),
    [programTypes, selectedProgramId]
  );

  // Duration = selected program duration
  const durationMinutes = selectedProgram?.durationMinutes ?? 0;

  // Attendees (for auto hall + availability)
  const [attendees, setAttendees] = useState<string>('');

  // Available start hours (0–23) from /api/availability
  const [availableHours, setAvailableHours] = useState<number[]>([]);

  // Auto-assign hall (Small → Main → Upper), respecting capacity
  const autoHall: Hall | undefined = useMemo(() => {
    if (locationType !== 'GURDWARA') return undefined;
    if (!halls.length) return undefined;

    // Prefer name match first, then fall back to capacity heuristics
    const small =
      halls.find((h) => /small/i.test(h.name)) ??
      halls.find(
        (h) =>
          typeof h.capacity === 'number' &&
          h.capacity > 100 &&
          h.capacity <= 125
      );

    const main =
      halls.find((h) => /main/i.test(h.name)) ??
      halls.find((h) => typeof h.capacity === 'number' && h.capacity > 125);

    // NEW: Upper Hall (capacity 100)
    const upper =
      halls.find((h) => /upper/i.test(h.name)) ??
      halls.find((h) => typeof h.capacity === 'number' && h.capacity <= 100);

    const ordered = [small, main, upper].filter(Boolean) as Hall[];

    const a = Number(attendees) || 0;
    // Pick the first hall (by preference) that can fit the attendee count.
    const fits = (h: Hall) =>
      typeof h.capacity === 'number' && h.capacity != null
        ? h.capacity >= a
        : true;

    return ordered.find(fits) ?? ordered[0];
  }, [halls, locationType, attendees]);

  // Live end-time preview
  const endPreview = useMemo(() => {
    const addHrs = Math.ceil((durationMinutes || 0) / 60);
    const end24 = (startHour24 + addHrs) % 24;
    return to12(end24);
  }, [startHour24, durationMinutes]);

  // Stable key for effects
  const selectedProgramKey = selectedProgramId || '';

  const hallId = autoHall?.id ?? null;

  // Load reference data
  useEffect(() => {
    fetch('/api/program-types')
      .then((r) => r.json())
      .then(setProgramTypes)
      .catch(() => {});
    fetch('/api/halls')
      .then((r) => r.json())
      .then(setHalls)
      .catch(() => {});
  }, []);

  // Fetch availability (uses autoHall if Gurdwara)
  useEffect(() => {
    if (!selectedProgramKey || !locationType) {
      setAvailableHours([]);
      return;
    }

    const params = new URLSearchParams({
      date,
      programTypeIds: selectedProgramKey, // server accepts CSV; single id is fine
      locationType,
    });
    if (attendees) params.set('attendees', attendees);
    if (locationType === 'GURDWARA' && hallId) {
      params.set('hallId', hallId);
    }

    const url = `/api/availability?${params.toString()}`;
    let aborted = false;

    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (aborted) return;
        setAvailableHours(Array.isArray(j.hours) ? j.hours : []);
      })
      .catch(() => {
        if (aborted) return;
        setAvailableHours([]);
      });

    return () => {
      aborted = true;
    };
  }, [date, selectedProgramKey, locationType, attendees, hallId]);

  // Keep selected start hour valid against available/business/past filters
  useEffect(() => {
    const minHour = minSelectableHour24(date);
    const allowed = visibleStartHours(availableHours).filter(
      (h) => h >= minHour
    );
    if (allowed.length && !allowed.includes(startHour24)) {
      setStartHour24(allowed[0]);
    }
  }, [availableHours, date, startHour24]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const fd = new FormData(form);

    if (!selectedProgramId) {
      setSubmitting(false);
      setError('Please select a program.');
      return;
    }
    const items = [{ programTypeId: selectedProgramId }];

    const loc = (locationType || String(fd.get('locationType') || '')) as
      | 'GURDWARA'
      | 'OUTSIDE_GURDWARA'
      | '';
    if (!loc) {
      setSubmitting(false);
      setError('Please select a Location (Gurdwara or Outside Gurdwara).');
      return;
    }
    if (loc === 'GURDWARA') {
      if (!autoHall?.id) {
        setSubmitting(false);
        setError('No suitable hall is available for the attendee count.');
        return;
      }
    }
    if (loc === 'OUTSIDE_GURDWARA' && !String(fd.get('address') || '').trim()) {
      setSubmitting(false);
      setError('Please provide the address.');
      return;
    }

    // Ensure chosen start time is still valid (if API provided hours)
    if (availableHours.length > 0 && !availableHours.includes(startHour24)) {
      setSubmitting(false);
      setError(
        'Selected start time is no longer available. Please pick another.'
      );
      return;
    }

    // Prevent booking in the past on the same date
    if (
      date === todayLocalDateString() &&
      startHour24 < minSelectableHour24(date)
    ) {
      setSubmitting(false);
      setError('Selected time has already passed. Please choose a later time.');
      return;
    }

    const startISO = toISOFromLocalDateHour(date, startHour24);
    const endISO = new Date(
      new Date(startISO).getTime() + (durationMinutes || 0) * 60 * 1000
    ).toISOString();

    const phoneRaw = phone || String(fd.get('contactPhone') || '');
    const phoneE164 = toE164Generic(phoneRaw); // '' means invalid

    if (!phoneE164) {
      setSubmitting(false);
      setError(
        'Please enter a valid phone number (include country code or use a local format).'
      );
      return;
    }

    if (!attendees || Number(attendees) < 1) {
      setSubmitting(false);
      setError('Please enter the number of attendees (at least 1).');
      return;
    }

    const payload = {
      title: String(fd.get('title') || '').trim(),
      start: startISO,
      end: endISO,
      locationType: loc as 'GURDWARA' | 'OUTSIDE_GURDWARA',
      hallId: loc === 'GURDWARA' ? autoHall?.id ?? null : null,
      address:
        loc === 'OUTSIDE_GURDWARA'
          ? String(fd.get('address') || '').trim() || null
          : null,
      contactName: String(fd.get('contactName') || '').trim(),
      contactPhone: phoneE164,
      notes: (fd.get('notes') as string | null) || null,
      items,
      attendees: Number(attendees),
    } as const;

    const parsed = CreateBookingSchema.safeParse(payload);
    if (!parsed.success) {
      setSubmitting(false);
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }

    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    setSubmitting(false);
    const j = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(j.error || 'Failed to create booking');
      return;
    }

    if (j?.id) {
      router.push(`/bookings/${j.id}/assignments`);
      return;
    }

    // fallback if no id returned
    setSuccess('✅ Booking created!');
    form.reset();
    setLocationType('');
    const n = new Date();
    setDate(toLocalDateString(n));
    setStartHour24(7);
    setPhone('');
    setSelectedProgramId('');
    setAvailableHours([]);
    setAttendees('');
  }

  return (
    <section className='section'>
      <div className='card p-4 md:p-6'>
        <h2 className='text-lg font-semibold mb-4'>Create a Booking</h2>

        {error && <div className='alert alert-error mb-4'>{error}</div>}
        {success && <div className='alert alert-success mb-4'>{success}</div>}

        <form id='book-form' className='space-y-6' onSubmit={handleSubmit}>
          {/* Details */}
          <div>
            <h3 className='text-sm font-semibold text-gray-700 mb-2'>
              Details
            </h3>
            <div className='grid md:grid-cols-2 gap-4'>
              <div className='md:col-span-2'>
                <label className='label'>Reason for occasion?</label>
                <input
                  className='input'
                  name='title'
                  required
                  placeholder='Family Kirtan / Houswarming etc'
                />
              </div>

              <div>
                <label className='label'>Location</label>
                <select
                  className='select'
                  name='locationType'
                  value={locationType}
                  onChange={(e) =>
                    setLocationType(e.target.value as LocationType)
                  }
                  required
                >
                  <option value='' disabled>
                    -- Select Location --
                  </option>
                  <option value='GURDWARA'>Gurdwara</option>
                  <option value='OUTSIDE_GURDWARA'>Outside Gurdwara</option>
                </select>
              </div>

              <div>
                <label className='label'>Attendees</label>
                <input
                  className='input'
                  type='number'
                  min={1}
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                />
              </div>

              {locationType === 'GURDWARA' && (
                <div className='md:col-span-2'>
                  <label className='label'>Hall (auto-assigned)</label>
                  <input
                    className='input bg-gray-100'
                    value={autoHall ? autoHall.name : 'Choosing…'}
                    readOnly
                  />
                  <p className='text-xs text-gray-500 mt-1'>
                    Preference: <strong>Small → Main → Upper</strong>. Upper
                    Hall capacity is <strong>100</strong>. We’ll auto-pick the
                    first that fits {attendees || 0} attendees.
                  </p>
                </div>
              )}

              {locationType === 'OUTSIDE_GURDWARA' && (
                <div className='md:col-span-2'>
                  <label className='label'>Address</label>
                  <AddressAutocomplete required />
                </div>
              )}
            </div>
          </div>

          {/* Program (SINGLE) */}
          <div>
            <h3 className='text-sm font-semibold text-gray-700 mb-2'>
              Program
            </h3>
            <div className='grid md:grid-cols-3 gap-3'>
              {programTypes.map((pt) => {
                const checked = selectedProgramId === pt.id;
                return (
                  <label
                    key={pt.id}
                    className='flex items-center gap-2 rounded-xl border border-black/10 p-3 hover:bg-black/5'
                  >
                    <input
                      type='radio'
                      name='programType'
                      value={pt.id}
                      checked={checked}
                      onChange={() => setSelectedProgramId(pt.id)}
                    />
                    <span className='text-sm'>
                      {pt.name}{' '}
                      <span className='text-xs text-gray-500'>
                        ({pt.category} •{' '}
                        {Math.ceil((pt.durationMinutes || 0) / 60)}h)
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {!selectedProgramId && (
              <p className='text-xs text-red-600 mt-2'>Select a program.</p>
            )}
          </div>

          {/* Schedule (Date & Time) */}
          <div>
            <h3 className='text-sm font-semibold text-gray-700 mb-2'>
              Schedule
            </h3>
            <div className='grid md:grid-cols-2 gap-4'>
              <div>
                <label className='label'>Date</label>
                <input
                  className='input'
                  type='date'
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              {/* Start Time (7 AM – 7 PM) */}
              <div>
                <label className='label'>Start Time</label>
                <select
                  className='select'
                  value={startHour24}
                  onChange={(e) => setStartHour24(Number(e.target.value))}
                  disabled={!selectedProgramId || !locationType}
                >
                  {(() => {
                    const minHour = minSelectableHour24(date);
                    const list = visibleStartHours(availableHours).filter(
                      (h) => h >= minHour
                    );

                    if (list.length === 0) {
                      return (
                        <option value='' disabled>
                          No times available for the selected date
                        </option>
                      );
                    }

                    return list.map((h24) => {
                      const { h12, ap } = to12(h24);
                      return (
                        <option key={h24} value={h24}>
                          {h12}:00 {ap}
                        </option>
                      );
                    });
                  })()}
                </select>

                {date === todayLocalDateString() && (
                  <p className='text-xs text-gray-500 mt-1'>
                    Past times today are hidden.
                  </p>
                )}

                {selectedProgramId &&
                  locationType &&
                  availableHours.length > 0 && (
                    <p className='text-xs text-gray-500 mt-1'>
                      Booked hours are hidden for {date}.
                    </p>
                  )}
                {selectedProgramId &&
                  locationType &&
                  availableHours.length === 0 && (
                    <p className='text-xs text-gray-500 mt-1'>
                      Showing standard hours (7 AM–7 PM).
                    </p>
                  )}
              </div>

              {/* End-time preview */}
              <div className='md:col-span-2 -mt-2'>
                <p className='text-xs text-gray-600'>
                  Ends at{' '}
                  <strong>
                    {endPreview.h12}:00 {endPreview.ap}
                  </strong>
                  {selectedProgram && (
                    <span className='text-xs text-gray-500'>
                      {' '}
                      • {Math.ceil((durationMinutes || 0) / 60)}h
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div>
            <h3 className='text-sm font-semibold text-gray-700 mb-2'>
              Contact
            </h3>
            <div className='grid md:grid-cols-2 gap-4'>
              <div>
                <label className='label'>Contact Name</label>
                <input
                  className='input'
                  name='contactName'
                  required
                  placeholder='Your full name'
                />
              </div>
              <div>
                <label className='label'>Phone</label>
                <input
                  className='input'
                  name='contactPhone'
                  autoComplete='tel' // allow Chrome to include +country when it knows it
                  inputMode='tel'
                  placeholder='+1 519 555 1234 or +91 98765 43210'
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneLive(e.target.value))}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text');
                    setPhone(formatPhoneLive(text));
                    e.preventDefault();
                  }}
                  // no maxLength; international can be longer than 14
                  required
                />
              </div>
            </div>
          </div>

          {/* Notes & Submit */}
          <div className='grid gap-4 md:grid-cols-[1fr_auto]'>
            <div>
              <label className='label'>Notes</label>
              <textarea
                className='textarea'
                name='notes'
                placeholder='Anything else we should know?'
              />
            </div>
            <div className='flex items-end mb-2'>
              <button
                className={`btn btn-primary w-full ${
                  submitting ? 'opacity-70' : ''
                }`}
                disabled={submitting}
                type='submit'
              >
                {submitting ? 'Submitting…' : 'Create Booking'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
