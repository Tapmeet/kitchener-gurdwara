'use client';
import { useEffect, useMemo, useState } from 'react';
import { CreateBookingSchema } from '@/lib/validation';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { allowedStartHoursFor } from '@/lib/businessHours';

/* ---------- helpers ---------- */

function toLocalDateFromString(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
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

// 24h -> 12h + AM/PM
function to12(h24: number): { h12: number; ap: 'AM' | 'PM' } {
  const ap: 'AM' | 'PM' = h24 < 12 ? 'AM' : 'PM';
  const h = h24 % 12;
  return { h12: h === 0 ? 12 : h, ap };
}

// 12h + AM/PM -> 24h
function from12(h12: number, ap: 'AM' | 'PM'): number {
  let h = h12 % 12; // 12 -> 0 baseline
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
  const [programTypes, setProgramTypes] = useState<any[]>([]);
  const [halls, setHalls] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phone, setPhone] = useState<string>('');

  const [locationType, setLocationType] = useState<'' | 'HALL' | 'HOME'>('');

  // Date + 12h time
  const now = useMemo(() => new Date(), []);
  const [date, setDate] = useState(toLocalDateString(now));
  const init12 = to12(now.getHours());
  const [startHour12, setStartHour12] = useState<number>(init12.h12); // 1–12
  const [startAmPm, setStartAmPm] = useState<'AM' | 'PM'>(init12.ap);
  const [durationHours, setDurationHours] = useState<number>(2);

  // Live end-time preview
  const endPreview = useMemo(() => {
    const start24 = from12(startHour12, startAmPm);
    const end24 = (start24 + durationHours) % 24;
    return to12(end24); // {h12, ap}
  }, [startHour12, startAmPm, durationHours]);

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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const fd = new FormData(form);

    // exactly one program
    const programId = String(fd.get('programType') || '');
    if (!programId) {
      setSubmitting(false);
      setError('Please select exactly one program.');
      return;
    }
    const items = [{ programTypeId: programId }];

    // location checks
    const loc = (locationType || String(fd.get('locationType') || '')) as
      | 'HALL'
      | 'HOME'
      | '';
    if (!loc) {
      setSubmitting(false);
      setError('Please select a Location (Hall or Home).');
      return;
    }
    if (loc === 'HALL' && !String(fd.get('hallId') || '')) {
      setSubmitting(false);
      setError('Please select a hall.');
      return;
    }
    if (loc === 'HOME' && !String(fd.get('address') || '').trim()) {
      setSubmitting(false);
      setError('Please provide the home address.');
      return;
    }

    // Validate slot against business hours again
    const localDate = toLocalDateFromString(date);
    const valid24 = allowedStartHoursFor(localDate, durationHours); // array of 0–23
    const startHour24 = from12(startHour12, startAmPm);
    if (!valid24.includes(startHour24)) {
      setSubmitting(false);
      setError(
        'Selected start time is not available for the chosen day and duration.'
      );
      return;
    }

    // Build ISO times (hour-aligned)
    const startISO = toISOFromLocalDateHour(date, startHour24);
    const endISO = new Date(
      new Date(startISO).getTime() + durationHours * 60 * 60 * 1000
    ).toISOString();

    const phonePretty = phone || String(fd.get('contactPhone') || '');
    const phoneE164 = toE164(phonePretty);

    const payload = {
      title: String(fd.get('title') || ''),
      start: startISO,
      end: endISO,
      locationType: loc as 'HALL' | 'HOME',
      hallId: String(fd.get('hallId') || '') || null,
      address: String(fd.get('address') || '') || null,
      contactName: String(fd.get('contactName') || ''),
      contactPhone: phoneE164,
      notes: String(fd.get('notes') || '') || null,
      items,
    };

    const parsed = CreateBookingSchema.safeParse(payload);
    if (!parsed.success) {
      setSubmitting(false);
      setError(parsed.error.errors.map((e) => e.message).join('; '));
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
      // Reset to now
      const n = new Date();
      setDate(toLocalDateString(n));
      const t12 = to12(n.getHours());
      setStartHour12(t12.h12);
      setStartAmPm(t12.ap);
      setDurationHours(2);
      setPhone('');
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
                  maxLength={14} // "(XXX) XXX-XXXX"
                  required
                />
              </div>
            </div>
          </div>

          {/* Details */}
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
                <label className='label'>Date</label>
                <input
                  className='input'
                  type='date'
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              {/* 12-hour time: hour + AM/PM (period-aware) */}
              <div className='grid grid-cols-2 gap-2'>
                <div>
                  <label className='label'>Start Hour</label>
                  <select
                    className='select'
                    value={startHour12}
                    onChange={(e) => setStartHour12(Number(e.target.value))}
                  >
                    {(() => {
                      const localDate = toLocalDateFromString(date);
                      const valid24 = allowedStartHoursFor(
                        localDate,
                        durationHours
                      ); // 0–23
                      const validForPeriod = valid24.filter(
                        (h24) => (h24 < 12 ? 'AM' : 'PM') === startAmPm
                      );

                      // snap if current selection not valid in this period
                      const currentValidH12s = validForPeriod.map((h24) => {
                        const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
                        return h12;
                      });
                      if (
                        !currentValidH12s.includes(startHour12) &&
                        validForPeriod.length
                      ) {
                        const first = validForPeriod[0];
                        const h12 = first % 12 === 0 ? 12 : first % 12;
                        if (startHour12 !== h12) setStartHour12(h12);
                      }

                      return validForPeriod.map((h24) => {
                        const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
                        return (
                          <option key={h24} value={h12}>
                            {h12}:00 {startAmPm}
                          </option>
                        );
                      });
                    })()}
                  </select>
                </div>
                <div>
                  <label className='label'>AM / PM</label>
                  <select
                    className='select'
                    value={startAmPm}
                    onChange={(e) => {
                      const nextAp = e.target.value as 'AM' | 'PM';
                      setStartAmPm(nextAp);

                      // adjust hour if new period has no matching hour
                      const localDate = toLocalDateFromString(date);
                      const valid24 = allowedStartHoursFor(
                        localDate,
                        durationHours
                      );
                      const validForNew = valid24.filter(
                        (h24) => (h24 < 12 ? 'AM' : 'PM') === nextAp
                      );
                      const current24 = from12(startHour12, nextAp);
                      if (!valid24.includes(current24) && validForNew.length) {
                        const first = validForNew[0];
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

              {/* Single live end-time preview */}
              <div className='md:col-span-2 -mt-2'>
                <p className='text-xs text-gray-600'>
                  Ends at{' '}
                  <strong>
                    {endPreview.h12}:00 {endPreview.ap}
                  </strong>
                </p>
              </div>

              {/* Single Duration selector */}
              <div>
                <label className='label'>Duration</label>
                <select
                  className='select'
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                >
                  {([1, 2, 3, 4] as const).map((h) => {
                    const localDate = toLocalDateFromString(date);
                    const valid = allowedStartHoursFor(localDate, h);
                    const disabled = valid.length === 0; // no start time can fit this duration on selected day
                    return (
                      <option key={h} value={h} disabled={disabled}>
                        {h} {h === 1 ? 'hour' : 'hours'}
                        {h === 2 ? ' (default)' : ''}
                        {disabled ? ' — not available that day' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className='label'>Location</label>
                <select
                  className='select'
                  name='locationType'
                  value={locationType}
                  onChange={(e) => {
                    const val = e.target.value as '' | 'HALL' | 'HOME';
                    setLocationType(val);
                    const hallSel = document.querySelector<HTMLSelectElement>(
                      'select[name="hallId"]'
                    );
                    const addrInp = document.querySelector<HTMLInputElement>(
                      'input[name="address"]'
                    );
                    if (val === 'HALL' && addrInp) addrInp.value = '';
                    if (val === 'HOME' && hallSel) hallSel.value = '';
                  }}
                  required
                >
                  <option value='' disabled>
                    -- Select Location --
                  </option>
                  <option value='HALL'>Hall</option>
                  <option value='HOME'>Home</option>
                </select>
              </div>

              {locationType === 'HALL' && (
                <div>
                  <label className='label'>Hall</label>
                  <select
                    className='select'
                    name='hallId'
                    defaultValue=''
                    required
                  >
                    <option value=''>-- Select Hall --</option>
                    {halls.map((h: any) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {locationType === 'HOME' && (
                <div className='md:col-span-2'>
                  <label className='label'>Address (Home)</label>
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
              {programTypes.map((pt: any) => (
                <label
                  key={pt.id}
                  className='flex items-center gap-2 rounded-xl border border-black/10 p-3 hover:bg-black/5'
                >
                  <input type='radio' name='programType' value={pt.id} />
                  <span className='text-sm'>
                    {pt.name}{' '}
                    <span className='text-xs text-gray-500'>
                      ({pt.category})
                    </span>
                  </span>
                </label>
              ))}
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
