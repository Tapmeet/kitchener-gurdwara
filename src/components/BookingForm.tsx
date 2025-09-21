'use client';
import { useEffect, useMemo, useState } from 'react';
import { CreateBookingSchema } from '@/lib/validation';
import AddressAutocomplete from '@/components/AddressAutocomplete';

/* ---------- types ---------- */
type LocationType = '' | 'GURDWARA' | 'OUTSIDE_GURDWARA';
type ProgramCategory = 'KIRTAN' | 'PATH' | 'OTHER';

interface ProgramType {
  id: string;
  name: string;
  category: ProgramCategory;
  durationMinutes: number; // used to compute end time
}

interface Hall {
  id: string;
  name: string;
  capacity?: number | null; // optional; we also match by name
}

/* ---------- helpers ---------- */
function toLocalDateString(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toISOFromLocalDateHour(dateStr: string, hour24: number) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const local = new Date(y, (m ?? 1) - 1, d ?? 1, hour24, 0, 0, 0);
  return local.toISOString();
}
// 24h -> 12h + AM/PM
function to12(h24: number): { h12: number; ap: 'AM' | 'PM' } {
  const ap: 'AM' | 'PM' = h24 < 12 ? 'AM' : 'PM';
  const h = h24 % 12;
  return { h12: h === 0 ? 12 : h, ap };
}
// 12h + AM/PM -> 24h
function from12(h12: number, ap: 'AM' | 'PM'): number {
  let h = h12 % 12;
  if (ap === 'PM') h += 12;
  return h;
}
// phone helpers
function digitsOnly(s: string) {
  return s.replace(/\D+/g, '');
}
function formatPhonePretty(digits: string) {
  const d = digitsOnly(digits).slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return a;
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}
function toE164(digits: string) {
  const d = digitsOnly(digits);
  if (d.length === 10) return `+1${d}`;
  return d ? `+1${d}` : '';
}

/* ---------- component ---------- */

export default function BookingForm() {
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
  const init12 = to12(now.getHours());
  const [startHour12, setStartHour12] = useState<number>(init12.h12); // 1–12
  const [startAmPm, setStartAmPm] = useState<'AM' | 'PM'>(init12.ap);

  // Program-driven duration
  const [selectedProgramId, setSelectedProgramId] = useState<string>('');
  const selectedProgram = useMemo(
    () => programTypes.find((p) => p.id === selectedProgramId),
    [programTypes, selectedProgramId]
  );
  const durationMinutes = selectedProgram?.durationMinutes ?? 0;

  // Attendees (for auto hall + availability)
  const [attendees, setAttendees] = useState<number>(1);

  // Available start hours (0–23) from /api/availability
  const [availableHours, setAvailableHours] = useState<number[]>([]);

  // Auto-assign hall (no user change)
  const autoHall: Hall | undefined = useMemo(() => {
    if (locationType !== 'GURDWARA') return undefined;
    if (!halls.length) return undefined;

    const small = halls.find(
      (h) =>
        (typeof h.capacity === 'number' && h.capacity <= 125) ||
        /small/i.test(h.name)
    );
    const main = halls.find(
      (h) =>
        (typeof h.capacity === 'number' && h.capacity > 125) ||
        /main/i.test(h.name)
    );

    // <125 => Small, otherwise Main (fallback if one not found)
    return (attendees || 0) < 125 ? small ?? main : main ?? small;
  }, [halls, locationType, attendees]);

  // Live end-time preview (from program duration)
  const endPreview = useMemo(() => {
    const start24 = from12(startHour12, startAmPm);
    const addHrs = Math.ceil((durationMinutes || 0) / 60);
    const end24 = (start24 + addHrs) % 24;
    return to12(end24);
  }, [startHour12, startAmPm, durationMinutes]);

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

  // fetch availability (uses autoHall if Gurdwara)
  useEffect(() => {
    if (!selectedProgramId || !locationType) {
      setAvailableHours([]);
      return;
    }
    const params = new URLSearchParams({
      date,
      programTypeId: selectedProgramId,
      locationType,
      attendees: String(attendees || 1),
    });
    if (locationType === 'GURDWARA' && autoHall?.id) {
      params.set('hallId', autoHall.id);
    }

    const url = `/api/availability?${params.toString()}`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => setAvailableHours(Array.isArray(j.hours) ? j.hours : []))
      .catch(() => setAvailableHours([]));
  }, [
    date,
    selectedProgramId,
    locationType,
    attendees,
    startAmPm,
    autoHall?.id,
  ]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const fd = new FormData(form);

    const programId = selectedProgramId || String(fd.get('programType') || '');
    if (!programId) {
      setSubmitting(false);
      setError('Please select exactly one program.');
      return;
    }
    const items = [{ programTypeId: programId }];

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

    // Ensure chosen start time is still valid
    const start24 = from12(startHour12, startAmPm);
    if (!availableHours.includes(start24)) {
      setSubmitting(false);
      setError(
        'Selected start time is no longer available. Please pick another.'
      );
      return;
    }

    const startISO = toISOFromLocalDateHour(date, start24);
    const endISO = new Date(
      new Date(startISO).getTime() + (durationMinutes || 0) * 60 * 1000
    ).toISOString();

    const phonePretty = phone || String(fd.get('contactPhone') || '');
    const phoneE164 = toE164(phonePretty);

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
      attendees,
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
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || 'Failed to create booking');
    } else {
      setSuccess('✅ Booking created!');
      form.reset();
      setLocationType('');
      const n = new Date();
      setDate(toLocalDateString(n));
      const t12 = to12(n.getHours());
      setStartHour12(t12.h12);
      setStartAmPm(t12.ap);
      setPhone('');
      setSelectedProgramId('');
      setAvailableHours([]);
      setAttendees(1);
    }
  }

  return (
    <section className='section'>
      <div className='card p-4 md:p-6'>
        <h2 className='text-lg font-semibold mb-4'>Create a Booking</h2>

        {error && <div className='alert alert-error mb-4'>{error}</div>}
        {success && <div className='alert alert-success mb-4'>{success}</div>}

        <form id='book-form' className='space-y-6' onSubmit={handleSubmit}>
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
                  autoComplete='tel'
                  inputMode='tel'
                  placeholder='(519) 555-1234'
                  value={phone}
                  onChange={(e) => setPhone(formatPhonePretty(e.target.value))}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text');
                    setPhone(formatPhonePretty(text));
                    e.preventDefault();
                  }}
                  maxLength={14}
                  required
                />
              </div>
            </div>
          </div>

          {/* Details (title, attendees, location, address / auto hall preview) */}
          <div>
            <h3 className='text-sm font-semibold text-gray-700 mb-2'>
              Details
            </h3>
            <div className='grid md:grid-cols-2 gap-4'>
              <div className='md:col-span-2'>
                <label className='label'>Title</label>
                <input
                  className='input'
                  name='title'
                  required
                  placeholder='Family Kirtan / Sukhmani Sahib'
                />
              </div>

              <div>
                <label className='label'>Attendees</label>
                <input
                  className='input'
                  type='number'
                  min={1}
                  value={attendees}
                  onChange={(e) => setAttendees(Number(e.target.value) || 1)}
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

              {locationType === 'GURDWARA' && (
                <div className='md:col-span-2'>
                  <label className='label'>Hall (auto-assigned)</label>
                  <input
                    className='input bg-gray-100'
                    value={autoHall ? autoHall.name : 'Choosing…'}
                    readOnly
                  />
                  <p className='text-xs text-gray-500 mt-1'>
                    Based on attendees ({attendees}): &lt;125 → Small Hall, ≥125
                    → Main Hall.
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

          {/* Programs (single) */}
          <div>
            <h3 className='text-sm font-semibold text-gray-700 mb-2'>
              Programs
            </h3>
            <div className='grid md:grid-cols-3 gap-3'>
              {programTypes.map((pt) => (
                <label
                  key={pt.id}
                  className='flex items-center gap-2 rounded-xl border border-black/10 p-3 hover:bg-black/5'
                >
                  <input
                    type='radio'
                    name='programType'
                    value={pt.id}
                    checked={selectedProgramId === pt.id}
                    onChange={() => setSelectedProgramId(pt.id)}
                    required
                  />
                  <span className='text-sm'>
                    {pt.name}{' '}
                    <span className='text-xs text-gray-500'>
                      ({pt.category} •{' '}
                      {Math.ceil((pt.durationMinutes || 0) / 60)}h)
                    </span>
                  </span>
                </label>
              ))}
            </div>
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

              {/* 12-hour time: hour + AM/PM */}
              <div className='grid grid-cols-2 gap-2'>
                <div>
                  <label className='label'>Start Hour</label>
                  <select
                    className='select'
                    value={startHour12}
                    onChange={(e) => setStartHour12(Number(e.target.value))}
                    disabled={!selectedProgramId || !locationType}
                  >
                    {(() => {
                      const period = startAmPm;
                      const apiHours = (availableHours || []).filter(
                        (h24) => (h24 < 12 ? 'AM' : 'PM') === period
                      );
                      const fallback24 =
                        period === 'AM'
                          ? Array.from({ length: 12 }, (_, i) => i) // 0..11
                          : Array.from({ length: 12 }, (_, i) => i + 12); // 12..23

                      const hoursToShow =
                        selectedProgramId && locationType
                          ? apiHours.length
                            ? apiHours
                            : fallback24
                          : [];
                      const options = hoursToShow.map((h24) => ({
                        h24,
                        h12: h24 % 12 === 0 ? 12 : h24 % 12,
                      }));
                      const validH12 = options.map((o) => o.h12);
                      if (options.length && !validH12.includes(startHour12)) {
                        setStartHour12(options[0].h12);
                      }

                      return options.map(({ h24, h12 }) => (
                        <option key={h24} value={h12}>
                          {h12}:00 {period}
                        </option>
                      ));
                    })()}
                  </select>

                  {selectedProgramId &&
                    locationType &&
                    availableHours.length === 0 && (
                      <p className='text-xs text-red-600 mt-1'>
                        No reserved slots found from the server; showing all{' '}
                        {startAmPm} hours as a fallback.
                      </p>
                    )}
                </div>

                <div>
                  <label className='label'>AM / PM</label>
                  <select
                    className='select'
                    value={startAmPm}
                    onChange={(e) => {
                      const nextAp = e.target.value as 'AM' | 'PM';
                      setStartAmPm(nextAp);

                      const apiHoursNext = (availableHours || []).filter(
                        (h24) => (h24 < 12 ? 'AM' : 'PM') === nextAp
                      );
                      const fallbackNext =
                        nextAp === 'AM'
                          ? Array.from({ length: 12 }, (_, i) => i)
                          : Array.from({ length: 12 }, (_, i) => i + 12);

                      const list = apiHoursNext.length
                        ? apiHoursNext
                        : fallbackNext;
                      const current24 = from12(startHour12, nextAp);
                      if (!list.includes(current24) && list.length) {
                        const first = list[0];
                        const h12 = first % 12 === 0 ? 12 : first % 12;
                        setStartHour12(h12);
                      }
                    }}
                  >
                    <option value='AM'>AM</option>
                    <option value='PM'>PM</option>
                  </select>
                </div>
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
