'use client';
import { useEffect, useState } from 'react';
import { CreateBookingSchema } from '@/lib/validation';
import AddressAutocomplete from '@/components/AddressAutocomplete';

function toLocalInputMinutes(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default function BookingForm() {
  const [programTypes, setProgramTypes] = useState<any[]>([]);
  const [halls, setHalls] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // controlled time fields to avoid SSR mismatch
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [durationMin, setDurationMin] = useState(120);

  // controlled location to toggle hall/address visibility
  const [locationType, setLocationType] = useState<'' | 'HALL' | 'HOME'>('');

  useEffect(() => {
    fetch('/api/program-types')
      .then((r) => r.json())
      .then(setProgramTypes)
      .catch(() => {});
    fetch('/api/halls')
      .then((r) => r.json())
      .then(setHalls)
      .catch(() => {});

    const now = new Date();
    setStart(toLocalInputMinutes(now));
    setEnd(toLocalInputMinutes(new Date(now.getTime() + 120 * 60000)));
  }, []);

  function onDurationChange(dur: number, s: string) {
    setDurationMin(dur);
    if (!s) return;
    const dt = new Date(s);
    setEnd(toLocalInputMinutes(new Date(dt.getTime() + dur * 60000)));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    // exactly one program
    const programId = String(formData.get('programType') || '');
    if (!programId) {
      setSubmitting(false);
      setError('Please select exactly one program.');
      return;
    }
    const items = [{ programTypeId: programId }];

    // location + dependent requirements
    const loc = (locationType || String(formData.get('locationType') || '')) as
      | 'HALL'
      | 'HOME'
      | '';
    if (!loc) {
      setSubmitting(false);
      setError('Please select a Location (Hall or Home).');
      return;
    }
    if (loc === 'HALL' && !String(formData.get('hallId') || '')) {
      setSubmitting(false);
      setError('Please select a hall.');
      return;
    }
    if (loc === 'HOME' && !String(formData.get('address') || '').trim()) {
      setSubmitting(false);
      setError('Please provide the home address.');
      return;
    }

    // times
    const startISO = new Date(
      String(formData.get('start') || start)
    ).toISOString();
    const endISO = new Date(String(formData.get('end') || end)).toISOString();

    const payload = {
      title: String(formData.get('title') || ''),
      start: startISO,
      end: endISO,
      locationType: loc as 'HALL' | 'HOME',
      hallId: String(formData.get('hallId') || '') || null,
      address: String(formData.get('address') || '') || null,
      contactName: String(formData.get('contactName') || ''),
      contactPhone: String(formData.get('contactPhone') || ''),
      notes: String(formData.get('notes') || '') || null,
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
      // recompute end to reflect current duration
      const s = start || toLocalInputMinutes(new Date());
      const dt = new Date(s);
      setEnd(toLocalInputMinutes(new Date(dt.getTime() + durationMin * 60000)));
      // keep location state in sync with cleared form
      setLocationType('');
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
                  required
                  placeholder='555-555-5555'
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
                <label className='label'>Start</label>
                <input
                  className='input'
                  type='datetime-local'
                  name='start'
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    onDurationChange(durationMin, e.target.value);
                  }}
                  required
                />
              </div>

              <div>
                <label className='label'>Duration</label>
                <select
                  className='select'
                  value={durationMin}
                  onChange={(e) =>
                    onDurationChange(Number(e.target.value), start)
                  }
                >
                  <option value={120}>2 hours (default)</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={180}>3 hours</option>
                  <option value={240}>4 hours</option>
                </select>
              </div>

              <div>
                <label className='label'>End</label>
                <input
                  className='input'
                  type='datetime-local'
                  name='end'
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
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

                    // NEW: bring address into view
                    if (val === 'HOME') {
                      setTimeout(() => {
                        document
                          .querySelector('input[name="address"]')
                          ?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center',
                          });
                        (
                          document.querySelector(
                            'input[name="address"]'
                          ) as HTMLInputElement | null
                        )?.focus();
                      }, 0);
                    }
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

              {/* Hall only when HALL */}
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
                    {halls.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Address only when HOME */}
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
