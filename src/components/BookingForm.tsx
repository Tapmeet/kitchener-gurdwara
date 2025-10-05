// src/components/BookingForm.tsx
'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CreateBookingSchema } from '@/lib/validation';
import AddressAutocomplete from '@/components/AddressAutocomplete';
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

/** Union of fields we show errors under */
type FieldKey =
  | 'form'
  | 'title'
  | 'locationType'
  | 'address'
  | 'attendees'
  | 'programType'
  | 'date'
  | 'startHour24'
  | 'contactName'
  | 'contactPhone'
  | 'hallId'
  | 'contactEmail';

type FieldErrors = Partial<Record<FieldKey, string>>;

/** Friendly, simple messages per field; extras map schema keys -> our fields */
const FRIENDLY: Record<FieldKey | 'start' | 'end' | 'items', string> = {
  form: "Couldn't create the booking. Please try again.",
  title: 'Please enter a reason.',
  locationType: 'Please choose a location.',
  address: 'Please enter the address.',
  attendees: 'How many people are coming? (at least 1).',
  programType: 'Please choose a program.',
  date: 'Please choose a date.',
  startHour24: 'Please choose a time.',
  contactName: 'Please enter your name.',
  contactPhone: 'Please enter a phone number.',
  hallId: 'No hall fits this many people.',
  // schema/server aliases:
  start: 'Please choose a time.',
  end: 'Please choose a time.',
  items: 'Please choose a program.',
  contactEmail: 'Please enter a valid email.',
};

function mapPathToKey(raw: unknown): FieldKey {
  const s = String(raw ?? '');
  if (s === 'start' || s === 'end') return 'startHour24';
  if (s === 'items') return 'programType';
  const known: FieldKey[] = [
    'form',
    'title',
    'locationType',
    'address',
    'attendees',
    'programType',
    'date',
    'startHour24',
    'contactName',
    'contactPhone',
    'hallId',
  ];
  return known.includes(s as FieldKey) ? (s as FieldKey) : 'form';
}
function msg(key: FieldKey, fallback?: string) {
  return FRIENDLY[key] || fallback || 'Please check this field.';
}

/* ---------- helpers ---------- */
function todayLocalDateString() {
  return toLocalDateString(new Date());
}
function minSelectableHour24(dateStr: string): number {
  const base = 7;
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

const BUSINESS_HOURS_24 = Array.from({ length: 13 }, (_, i) => i + 7);

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
  const [programTypes, setProgramTypes] = useState<ProgramType[]>([]);

  const [errors, setErrors] = useState<FieldErrors>({});
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

  // Duration
  const durationMinutes = selectedProgram?.durationMinutes ?? 0;

  // Attendees
  const [attendees, setAttendees] = useState<string>('');

  // Available start hours
  const [availableHours, setAvailableHours] = useState<number[]>([]);

  // End-time preview
  const endPreview = useMemo(() => {
    const addHrs = Math.ceil((durationMinutes || 0) / 60);
    const end24 = (startHour24 + addHrs) % 24;
    return to12(end24);
  }, [startHour24, durationMinutes]);

  const selectedProgramKey = selectedProgramId || '';

  // Load reference data
  useEffect(() => {
    fetch('/api/program-types')
      .then((r) => r.json())
      .then(setProgramTypes)
      .catch(() => {});
  }, []);

  // Fetch availability (hall is backend concern; we just pass attendees + location)
  useEffect(() => {
    if (!selectedProgramKey || !locationType) {
      setAvailableHours([]);
      return;
    }

    const params = new URLSearchParams({
      date,
      programTypeIds: selectedProgramKey,
      locationType,
    });
    if (attendees) params.set('attendees', attendees);

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
  }, [date, selectedProgramKey, locationType, attendees]);

  // Keep selected start hour valid
  useEffect(() => {
    const minHour = minSelectableHour24(date);
    const allowed = visibleStartHours(availableHours).filter(
      (h) => h >= minHour
    );
    if (allowed.length && !allowed.includes(startHour24)) {
      setStartHour24(allowed[0]);
    }
  }, [availableHours, date, startHour24]);

  /* ---- Specific refs per field ---- */
  const titleRef = useRef<HTMLInputElement | null>(null);
  const locationTypeRef = useRef<HTMLSelectElement | null>(null);
  const attendeesRef = useRef<HTMLInputElement | null>(null);
  const programTypeRef = useRef<HTMLInputElement | null>(null); // first radio
  const dateRef = useRef<HTMLInputElement | null>(null);
  const startHour24Ref = useRef<HTMLSelectElement | null>(null);
  const contactNameRef = useRef<HTMLInputElement | null>(null);
  const contactPhoneRef = useRef<HTMLInputElement | null>(null);
  const successTimerRef = useRef<number | null>(null);

  function flashSuccess(text: string, ms = 2500) {
    setSuccess(text);
    if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    successTimerRef.current = window.setTimeout(() => setSuccess(null), ms);
  }

  useEffect(() => {
    return () => {
      if (successTimerRef.current) window.clearTimeout(successTimerRef.current);
    };
  }, []);

  function getElementForKey(key: FieldKey): HTMLElement | null {
    switch (key) {
      case 'title':
        return titleRef.current;
      case 'locationType':
        return locationTypeRef.current;
      case 'attendees':
        return attendeesRef.current;
      case 'programType':
        return programTypeRef.current;
      case 'date':
        return dateRef.current;
      case 'startHour24':
        return startHour24Ref.current;
      case 'contactName':
        return contactNameRef.current;
      case 'contactPhone':
        return contactPhoneRef.current;
      case 'address': {
        return typeof document !== 'undefined'
          ? (document.querySelector('[name="address"]') as HTMLElement | null)
          : null;
      }
      default:
        return null;
    }
  }

  function focusFirstInvalid(keys: FieldErrors) {
    const order: FieldKey[] = [
      'programType',
      'title',
      'locationType',
      'attendees',
      'date',
      'startHour24',
      'contactName',
      'contactPhone',
      'address',
      'form',
    ];
    const first = order.find((k) => keys[k]);
    if (!first) return;
    const el = getElementForKey(first);
    el?.focus?.();
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }

  function clearFieldError<K extends FieldKey>(k: K) {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  }

  function resetAll(form?: HTMLFormElement | null) {
    setErrors({});
    setSuccess(null);
    setLocationType('');
    const n = new Date();
    setDate(toLocalDateString(n));
    setStartHour24(7);
    setPhone('');
    setSelectedProgramId('');
    setAvailableHours([]);
    setAttendees('');
    if (form) form.reset();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSuccess(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const fd = new FormData(form);

    const nextErrors: FieldErrors = {};

    if (!selectedProgramId) {
      nextErrors.programType = FRIENDLY.programType;
    }
    const loc = (locationType || String(fd.get('locationType') || '')) as
      | 'GURDWARA'
      | 'OUTSIDE_GURDWARA'
      | '';
    if (!loc) {
      nextErrors.locationType = FRIENDLY.locationType;
    }
    if (loc === 'OUTSIDE_GURDWARA' && !String(fd.get('address') || '').trim()) {
      nextErrors.address = FRIENDLY.address;
    }

    if (availableHours.length > 0 && !availableHours.includes(startHour24)) {
      nextErrors.startHour24 = 'That time is taken. Please pick another time.';
    }
    if (
      date === todayLocalDateString() &&
      startHour24 < minSelectableHour24(date)
    ) {
      nextErrors.startHour24 =
        'That time has already passed. Pick a later time.';
    }

    const startISO = toISOFromLocalDateHour(date, startHour24);
    const endISO = new Date(
      new Date(startISO).getTime() + (durationMinutes || 0) * 60 * 1000
    ).toISOString();

    const phoneRaw = phone || String(fd.get('contactPhone') || '');
    const phoneE164 = toE164Generic(phoneRaw);
    if (!phoneE164) {
      nextErrors.contactPhone = FRIENDLY.contactPhone;
    }

    if (!attendees || Number(attendees) < 1) {
      nextErrors.attendees = FRIENDLY.attendees;
    }

    const contactEmailRaw = String(fd.get('contactEmail') || '').trim();

    const payload = {
      title: String(fd.get('title') || '').trim(),
      start: startISO,
      end: endISO,
      locationType: loc as 'GURDWARA' | 'OUTSIDE_GURDWARA',
      // hallId is not sent; server chooses automatically
      address:
        loc === 'OUTSIDE_GURDWARA'
          ? String(fd.get('address') || '').trim() || null
          : null,
      contactName: String(fd.get('contactName') || '').trim(),
      contactPhone: phoneE164,
      notes: (fd.get('notes') as string | null) || null,
      items: selectedProgramId ? [{ programTypeId: selectedProgramId }] : [],
      attendees: Number(attendees),
      contactEmail: contactEmailRaw || null,
    } as const;

    const parsed = CreateBookingSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = mapPathToKey(issue.path?.[0]);
        if (!nextErrors[key]) nextErrors[key] = msg(key, issue.message);
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setSubmitting(false);
      setErrors(nextErrors);
      focusFirstInvalid(nextErrors);
      return;
    }

    // Submit to server
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    setSubmitting(false);
    const j: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      const serverErrors: FieldErrors = {};
      if (Array.isArray(j?.issues)) {
        for (const issue of j.issues) {
          const key = mapPathToKey(issue?.path?.[0]);
          const m =
            typeof issue?.message === 'string' ? issue.message : undefined;
          if (!serverErrors[key]) serverErrors[key] = msg(key, m);
        }
      } else if (j?.fieldErrors && typeof j.fieldErrors === 'object') {
        for (const [k, v] of Object.entries(
          j.fieldErrors as Record<string, unknown>
        )) {
          const key = mapPathToKey(k);
          const first = Array.isArray(v) ? (v as any[])[0] : v;
          const m = typeof first === 'string' ? first : undefined;
          if (!serverErrors[key]) serverErrors[key] = msg(key, m);
        }
      } else if (typeof j?.error === 'string') {
        serverErrors.form = msg('form', j.error);
      } else {
        serverErrors.form = msg('form');
      }

      setErrors(serverErrors);
      focusFirstInvalid(serverErrors);
      return;
    }

    // Success
    setErrors({});
    resetAll(form);
    flashSuccess('✅ Path/Kirtan Booking created successfully!');
  }

  const invalidCls = 'border-red-500 ring-red-500 focus:ring-red-500';

  return (
    <section className='section'>
      {/* Floating toast (no layout shift) */}
      <div aria-live='polite' aria-atomic='true'>
        {success && (
          <div className='pointer-events-none fixed inset-x-0 top-28 z-50 flex justify-center px-4'>
            <div
              className='pointer-events-auto alert alert-success shadow-lg max-w-lg w-full transition-opacity duration-300'
              role='status'
            >
              {success}
            </div>
          </div>
        )}
      </div>
      <div className='card p-4 md:p-6'>
        <h2 className='text-lg font-semibold mb-4'>
          Create a Path/Kirtan Booking
        </h2>

        {errors.form && (
          <div className='alert alert-error mb-4' role='alert'>
            {errors.form}
          </div>
        )}

        <form
          id='book-form'
          className='space-y-6'
          onSubmit={handleSubmit}
          noValidate
        >
          {/* Details */}
          <div>
            <h3 className='text-sm font-semibold text-gray-700 mb-2'>
              Details
            </h3>
            <div className='grid md:grid-cols-2 gap-4'>
              <div className='md:col-span-2'>
                <label className='label' htmlFor='title'>
                  Reason for occasion?
                </label>
                <input
                  ref={titleRef}
                  id='title'
                  className={`input ${errors.title ? invalidCls : ''}`}
                  name='title'
                  required
                  placeholder='Family Kirtan / Housewarming etc'
                  onChange={() => clearFieldError('title')}
                  aria-invalid={!!errors.title}
                  aria-describedby={errors.title ? 'err-title' : undefined}
                />
                {errors.title && (
                  <p id='err-title' className='text-xs text-red-600 mt-1'>
                    {errors.title}
                  </p>
                )}
              </div>

              <div>
                <label className='label' htmlFor='locationType'>
                  Location
                </label>
                <select
                  ref={locationTypeRef}
                  id='locationType'
                  className={`select ${errors.locationType ? invalidCls : ''}`}
                  name='locationType'
                  value={locationType}
                  onChange={(e) => {
                    setLocationType(e.target.value as LocationType);
                    clearFieldError('locationType');
                  }}
                  required
                  aria-invalid={!!errors.locationType}
                  aria-describedby={
                    errors.locationType ? 'err-locationType' : undefined
                  }
                >
                  <option value='' disabled>
                    -- Select Location --
                  </option>
                  <option value='GURDWARA'>Gurdwara</option>
                  <option value='OUTSIDE_GURDWARA'>Outside Gurdwara</option>
                </select>
                {errors.locationType && (
                  <p
                    id='err-locationType'
                    className='text-xs text-red-600 mt-1'
                  >
                    {errors.locationType}
                  </p>
                )}
              </div>

              <div>
                <label className='label' htmlFor='attendees'>
                  Attendees
                </label>
                <input
                  ref={attendeesRef}
                  id='attendees'
                  className={`input ${errors.attendees ? invalidCls : ''}`}
                  type='number'
                  min={1}
                  value={attendees}
                  onChange={(e) => {
                    setAttendees(e.target.value);
                    clearFieldError('attendees');
                  }}
                  aria-invalid={!!errors.attendees}
                  aria-describedby={
                    errors.attendees ? 'err-attendees' : undefined
                  }
                />
                {errors.attendees && (
                  <p id='err-attendees' className='text-xs text-red-600 mt-1'>
                    {errors.attendees}
                  </p>
                )}
              </div>

              {locationType === 'OUTSIDE_GURDWARA' && (
                <div className='md:col-span-2'>
                  <label className='label'>Address</label>
                  <AddressAutocomplete required />
                  {errors.address && (
                    <p id='err-address' className='text-xs text-red-600 mt-1'>
                      {errors.address}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Program */}
          <div>
            <h3 className='text-sm font-semibold text-gray-700 mb-2'>
              Program
            </h3>
            <div className='grid md:grid-cols-3 gap-3'>
              {programTypes.map((pt, idx) => {
                const checked = selectedProgramId === pt.id;
                const radioErr = Boolean(errors.programType);
                return (
                  <label
                    key={pt.id}
                    className={`flex items-center gap-2 rounded-xl border p-3 hover:bg-black/5 ${radioErr ? 'border-red-500' : 'border-black/10'}`}
                  >
                    <input
                      type='radio'
                      name='programType'
                      value={pt.id}
                      checked={checked}
                      ref={idx === 0 ? programTypeRef : undefined}
                      onChange={() => {
                        setSelectedProgramId(pt.id);
                        clearFieldError('programType');
                      }}
                      aria-invalid={radioErr}
                      aria-describedby={
                        radioErr ? 'err-programType' : undefined
                      }
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
            {errors.programType && (
              <p id='err-programType' className='text-xs text-red-600 mt-2'>
                {errors.programType}
              </p>
            )}
          </div>

          {/* Schedule */}
          <div>
            <h3 className='text-sm font-semibold text-gray-700 mb-2'>
              Schedule
            </h3>
            <div className='grid md:grid-cols-2 gap-4'>
              <div>
                <label className='label' htmlFor='date'>
                  Date
                </label>
                <input
                  ref={dateRef}
                  id='date'
                  className={`input ${errors.date ? invalidCls : ''}`}
                  type='date'
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    clearFieldError('date');
                    clearFieldError('startHour24');
                  }}
                  required
                  aria-invalid={!!errors.date}
                  aria-describedby={errors.date ? 'err-date' : undefined}
                />
                {errors.date && (
                  <p id='err-date' className='text-xs text-red-600 mt-1'>
                    {errors.date}
                  </p>
                )}
              </div>

              <div>
                <label className='label' htmlFor='startHour24'>
                  Start Time
                </label>
                <select
                  ref={startHour24Ref}
                  id='startHour24'
                  className={`select ${errors.startHour24 ? invalidCls : ''}`}
                  value={startHour24}
                  onChange={(e) => {
                    setStartHour24(Number(e.target.value));
                    clearFieldError('startHour24');
                  }}
                  disabled={!selectedProgramId || !locationType}
                  aria-invalid={!!errors.startHour24}
                  aria-describedby={
                    errors.startHour24 ? 'err-startHour24' : undefined
                  }
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

                {errors.startHour24 && (
                  <p id='err-startHour24' className='text-xs text-red-600 mt-1'>
                    {errors.startHour24}
                  </p>
                )}

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
                  className={`input ${errors.contactName ? invalidCls : ''}`}
                  name='contactName'
                  required
                  placeholder='Your full name'
                  onChange={() => clearFieldError('contactName')}
                />
                {errors.contactName && (
                  <p className='text-xs text-red-600 mt-1'>
                    {errors.contactName}
                  </p>
                )}
              </div>

              <div>
                <label className='label'>Phone</label>
                <input
                  className={`input ${errors.contactPhone ? invalidCls : ''}`}
                  name='contactPhone'
                  autoComplete='tel'
                  inputMode='tel'
                  placeholder='+1 519 555 1234 or +91 98765 43210'
                  value={phone}
                  onChange={(e) => {
                    setPhone(formatPhoneLive(e.target.value));
                    clearFieldError('contactPhone');
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text');
                    setPhone(formatPhoneLive(text));
                    clearFieldError('contactPhone');
                    e.preventDefault();
                  }}
                  required
                />
                {errors.contactPhone && (
                  <p className='text-xs text-red-600 mt-1'>
                    {errors.contactPhone}
                  </p>
                )}
              </div>

              <div className='md:col-span-2'>
                <label className='label'>Email (for confirmation)</label>
                <input
                  className={`input ${errors.contactEmail ? invalidCls : ''}`}
                  type='email'
                  name='contactEmail'
                  placeholder='you@example.com'
                  onChange={() => clearFieldError('contactEmail')}
                />
                {errors.contactEmail && (
                  <p className='text-xs text-red-600 mt-1'>
                    {errors.contactEmail}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Notes & Submit */}
          <div className='grid gap-4 md:grid-cols-[1fr_auto]'>
            <div>
              <label className='label' htmlFor='notes'>
                Any other information?
              </label>
              <textarea
                id='notes'
                className='textarea'
                name='notes'
                placeholder='Anything else we should know or any request/clarifications?'
              />
            </div>
            <div className='flex items-end mb-2'>
              <button
                className={`btn btn-primary w-full ${submitting ? 'opacity-70' : ''}`}
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
