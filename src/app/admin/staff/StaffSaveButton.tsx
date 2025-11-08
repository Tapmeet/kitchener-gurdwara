'use client';

import { useFormStatus } from 'react-dom';
import { useEffect, useRef, useState } from 'react';

export function StaffSaveButton() {
  const { pending } = useFormStatus();
  const [justSaved, setJustSaved] = useState(false);
  const prevPending = useRef(false);

  useEffect(() => {
    // when we go from pending -> not pending, show "Saved" briefly
    if (prevPending.current && !pending) {
      setJustSaved(true);
      const t = setTimeout(() => setJustSaved(false), 2000);
      return () => clearTimeout(t);
    }
    prevPending.current = pending;
  }, [pending]);

  const btnClassName = [
    // same vibe as BookingForm submit button
    'whitespace-nowrap rounded-md px-4 py-2 font-medium text-white transition',
    'relative overflow-hidden border border-white/15',
    'bg-gradient-to-b from-blue-900/80 to-blue-900/60 backdrop-blur',
    'hover:from-blue-800/80 hover:to-blue-800/60 active:scale-[.99]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    pending ? 'opacity-70' : '',
  ].join(' ');

  return (
    <div className='inline-flex items-center gap-2'>
      <button type='submit' disabled={pending} className={btnClassName}>
        {pending ? 'Saving…' : 'Save'}
      </button>
      {justSaved && !pending && (
        <span className='text-xs text-green-600' aria-live='polite'>
          Saved
        </span>
      )}
    </div>
  );
}
