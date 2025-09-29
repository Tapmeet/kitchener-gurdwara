'use client';
import { FormEvent, useState, useEffect, useMemo } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

/** Strictly allow same-origin relative paths to avoid open redirects. */
function sanitizeCallbackUrl(raw: string | null): string {
  if (!raw) return '/';
  try {
    if (
      raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('//')
    )
      return '/';
    if (!raw.startsWith('/')) return '/';
    if (raw.includes('\n') || raw.includes('\r')) return '/';
    return raw;
  } catch {
    return '/';
  }
}

const ERROR_MAP: Record<string, string> = {
  OAuthSignin: 'Could not sign in with the provider.',
  OAuthCallback: 'Provider callback failed.',
  OAuthCreateAccount: 'Could not create account with the provider.',
  EmailCreateAccount: 'Could not create account with email.',
  CallbackRouteError: 'Authentication callback failed.',
  AccessDenied: 'Access denied.',
  Verification: 'Verification failed.',
  CredentialsSignin: 'Invalid email or password.',
  Configuration: 'Auth configuration error. Please contact the admin.',
  Default: 'Unexpected error. Please try again.',
};

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-5 w-5" {...props}>
      <path fill="#EA4335" d="M24 9.5c3.15 0 5.98 1.09 8.21 2.91l6.15-6.15C34.89 3.1 29.79 1 24 1 14.64 1 6.64 6.39 3.09 14.06l7.8 6.06C12.43 14.28 17.73 9.5 24 9.5z"/>
      <path fill="#34A853" d="M24 46c6.12 0 11.27-2.02 15.02-5.49l-7.18-5.88c-2.01 1.35-4.58 2.16-7.84 2.16-6 0-11.1-4.04-12.93-9.48l-7.9 6.1C6.76 40.87 14.62 46 24 46z"/>
      <path fill="#4A90E2" d="M44.5 24c0-1.58-.14-3.07-.41-4.5H24v9h11.68c-.51 2.6-2.02 4.8-4.34 6.13l7.18 5.88C42.02 37.27 44.5 31.25 44.5 24z"/>
      <path fill="#FBBC05" d="M10.09 27.31A14.5 14.5 0 0 1 9.5 24c0-1.15.19-2.27.54-3.31l-7.8-6.06A22.8 22.8 0 0 0 1.5 24c0 3.67.89 7.13 2.49 10.17l7.9-6.86z"/>
    </svg>
  );
}


function AppleIcon() {
  return (
    <svg
      aria-hidden='true'
      focusable='false'
      viewBox='0 0 24 24'
      className='h-5 w-5'
    >
      <path
        d='M16.365 12.465c-.027-2.424 1.98-3.586 2.07-3.644-1.127-1.652-2.88-1.879-3.5-1.904-1.486-.151-2.895.87-3.647.87-.752 0-1.915-.848-3.146-.825-1.62.024-3.116.942-3.95 2.39-1.68 2.914-.428 7.22 1.207 9.58.8 1.152 1.755 2.449 3.01 2.403 1.207-.046 1.662-.777 3.123-.777 1.462 0 1.872.777 3.147.753 1.305-.023 2.133-1.176 2.932-2.33.923-1.354 1.305-2.662 1.329-2.73-.03-.015-2.552-.981-2.575-3.786zM14.1 4.707c.665-.807 1.112-1.927.99-3.053-.958.038-2.116.637-2.8 1.444-.616.713-1.153 1.868-1.01 2.964 1.07.083 2.154-.55 2.82-1.355z'
        fill='currentColor'
      />
    </svg>
  );
}

export default function LoginPage() {
  const params = useSearchParams();
  const router = useRouter();

  const callbackUrl = useMemo(
    () => sanitizeCallbackUrl(params.get('callbackUrl')),
    [params]
  );
  const urlError = params.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [oauthSubmitting, setOauthSubmitting] = useState<
    'google' | 'apple' | null
  >(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!urlError) return;
    setErrorMsg(ERROR_MAP[urlError] || ERROR_MAP.Default);
  }, [urlError]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || oauthSubmitting) return;
    setErrorMsg(null);

    const trimmedEmail = email.trim();
    const trimmedPassword = password;

    if (!trimmedEmail || !trimmedPassword) {
      setErrorMsg('Please enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await signIn('credentials', {
        email: trimmedEmail,
        password: trimmedPassword,
        redirect: false,
        callbackUrl,
      });

      if (!res) {
        setErrorMsg('No response from server. Please try again.');
      } else if (res.error) {
        setErrorMsg(ERROR_MAP[res.error] || res.error || ERROR_MAP.Default);
      } else {
        router.push(res.url || callbackUrl);
      }
    } catch (err: any) {
      setErrorMsg(
        'Unexpected error. Please try again.' +
          (err?.message ? ` (${err.message})` : '')
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function onProvider(provider: 'google' | 'apple') {
    if (submitting || oauthSubmitting) return;
    setErrorMsg(null);
    setOauthSubmitting(provider);
    try {
      // NextAuth will handle the redirect. Keep callbackUrl sanitized.
      await signIn(provider, { callbackUrl });
    } finally {
      // If the redirect is blocked (popup blockers in future changes), we reset.
      setOauthSubmitting(null);
    }
  }

  const anyLoading = submitting || oauthSubmitting !== null;

  return (
    <div className='min-h-[60vh] flex items-center justify-center p-6'>
      <div className='w-full max-w-md space-y-6 rounded-xl border border-black/10 p-6 bg-white'>
        <h1 className='text-lg font-semibold'>Sign in</h1>

        {errorMsg && (
          <div
            role='alert'
            className='rounded-md bg-red-50 text-red-800 text-sm p-3'
          >
            {errorMsg}
          </div>
        )}

        <form onSubmit={onSubmit} className='space-y-3'>
          <div>
            <label className='label block text-sm font-medium mb-1'>
              Email
            </label>
            <input
              className='input w-full block rounded-md border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20'
              type='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete='email'
              required
              disabled={anyLoading}
            />
          </div>
          <div>
            <label className='label block text-sm font-medium mb-1'>
              Password
            </label>
            <input
              className='input w-full block rounded-md border border-black/10 px-3 py-2 outline-none focus:ring-2 focus:ring-black/20'
              type='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete='current-password'
              required
              disabled={anyLoading}
            />
          </div>
          <button
            className='btn btn-primary w-full rounded-md bg-black text-white py-2 font-medium disabled:opacity-50'
            type='submit'
            disabled={anyLoading}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* Separator styled like the screenshot */}
        <div className='flex items-center gap-3'>
          <div className='h-px flex-1 bg-black/10' />
          <div className='text-xs tracking-wide text-gray-500'>
            OR
          </div>
          <div className='h-px flex-1 bg-black/10' />
        </div>

        {/* Provider buttons */}
        <div className='grid gap-2'>
          <button
            type='button'
            onClick={() => onProvider('google')}
            disabled={anyLoading}
            className='w-full inline-flex items-center justify-center gap-2 rounded-md border border-black/15 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50'
          >
            <GoogleIcon />
            {oauthSubmitting === 'google' ? 'Continuing…' : 'Sign in with Google'}
          </button>

          {process.env.NEXT_PUBLIC_ENABLE_APPLE === 'true' && (
            <button
              type='button'
              onClick={() => onProvider('apple')}
              disabled={anyLoading}
              title='Apple Sign-in requires HTTPS for callback'
              className='w-full inline-flex items-center justify-center gap-2 rounded-md border border-black/15 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50'
            >
              <AppleIcon />
              {oauthSubmitting === 'apple' ? 'Continuing…' : 'Apple'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
