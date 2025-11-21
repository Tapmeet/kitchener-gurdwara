'use client';

import { FormEvent, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function sanitizeCallbackUrl(raw: string | null): string {
  if (!raw) return '/';
  try {
    if (
      raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('//')
    ) {
      return '/';
    }

    const url = new URL(raw, 'http://localhost');
    if (!url.pathname.startsWith('/')) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = sanitizeCallbackUrl(searchParams.get('callbackUrl'));

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password;

    if (!trimmedName || !trimmedEmail || !trimmedPassword) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }

    if (trimmedPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }

    if (trimmedPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      // 1) Create the account
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          phone: phone.trim() || undefined,
          password: trimmedPassword,
        }),
      });

      const data = await res.json().catch(() => ({}) as any);

      if (!res.ok) {
        setErrorMsg(
          data?.error || 'Could not create your account. Please try again.'
        );
        return;
      }

      // 2) Sign them in with credentials
      const signInRes = await signIn('credentials', {
        email: trimmedEmail,
        password: trimmedPassword,
        redirect: false,
        callbackUrl,
      });

      if (!signInRes || signInRes.error) {
        setErrorMsg(
          signInRes?.error ||
            'Account created, but sign-in failed. Please log in.'
        );
        router.push('/login');
        return;
      }

      router.push(signInRes.url || callbackUrl || '/');
    } catch (err: any) {
      setErrorMsg(
        'Unexpected error. Please try again.' +
          (err?.message ? ` (${err.message})` : '')
      );
    } finally {
      setSubmitting(false);
    }
  }

  const signupButtonClasses = `
  w-full whitespace-nowrap rounded-md px-4 py-2 font-medium text-white
  relative overflow-hidden border border-white/15
  bg-gradient-to-b from-blue-900/80 to-blue-900/60 backdrop-blur
  hover:from-blue-800/80 hover:to-blue-800/60
  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40
  active:scale-[.99] transition
  disabled:opacity-50 disabled:cursor-not-allowed`;
  
  const inputClasses =
    'w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-900 ' +
    'shadow-inner focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40 ' +
    'transition-colors';

  const labelClasses = 'block text-xs font-medium text-slate-700 mb-1';
  const hintClasses = 'mt-1 text-[11px] text-slate-500';

  const loginHref =
    '/login' +
    (callbackUrl && callbackUrl !== '/'
      ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : '');

  return (
    <div className='flex items-center justify-center px-4 py-10'>
      <div className='w-full max-w-md'>
        {/* Page heading aligned with GTSA theme */}
        <div className='mb-6 text-center'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-900/80'>
            Golden Triangle Sikh Association
          </p>
          <h1 className='mt-2 text-xl font-semibold text-slate-900'>
            Create an account
          </h1>
          <p className='mt-1 text-xs text-slate-500 sm:text-sm'>
            Sign up with your email to view your bookings and assignments.
          </p>
        </div>

        {/* Card */}
        <div className='relative rounded-2xl border border-slate-200 bg-white/95 shadow-xl shadow-slate-900/10'>
          {/* Thin gradient accent line on top of the card */}
          <div
            aria-hidden='true'
            className='pointer-events-none absolute inset-x-8 -top-px h-px bg-gradient-to-r from-sky-400 via-amber-300 to-sky-400'
          />

          <div className='px-6 py-5 sm:px-7 sm:py-6'>
            {errorMsg && (
              <div className='mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'>
                {errorMsg}
              </div>
            )}

            <form onSubmit={onSubmit} className='space-y-3'>
              <div>
                <label className={labelClasses}>Name</label>
                <input
                  type='text'
                  className={inputClasses}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete='name'
                  required
                />
              </div>

              <div>
                <label className={labelClasses}>Email</label>
                <input
                  type='email'
                  className={inputClasses}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete='email'
                  required
                />
              </div>

              <div>
                <label className={labelClasses}>Phone (optional)</label>
                <input
                  type='tel'
                  className={inputClasses}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete='tel'
                />
              </div>

              <div>
                <label className={labelClasses}>Password</label>
                <input
                  type='password'
                  className={inputClasses}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete='new-password'
                  required
                />
                <p className={hintClasses}>Minimum 8 characters.</p>
              </div>

              <div>
                <label className={labelClasses}>Confirm password</label>
                <input
                  type='password'
                  className={inputClasses}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete='new-password'
                  required
                />
              </div>

              <button
                type='submit'
                disabled={submitting}
                className={signupButtonClasses}
              >
                {submitting ? 'Creating your account…' : 'Sign up'}
              </button>
            </form>

            <p className='mt-4 text-xs text-slate-500 text-center'>
              Already have an account?{' '}
              <Link
                href={loginHref}
                className='font-medium text-blue-900 hover:text-blue-800 hover:underline'
              >
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
