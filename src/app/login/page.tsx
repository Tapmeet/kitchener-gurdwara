'use client';
import { FormEvent, useState, useEffect, useMemo } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

function sanitizeCallbackUrl(raw: string | null): string {
  // Only allow same-origin relative paths. Everything else falls back to "/".
  if (!raw) return '/';
  try {
    // Disallow absolute URLs and protocol-relative
    if (
      raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('//')
    )
      return '/';
    // Must start with a single slash to be a path on this site
    if (!raw.startsWith('/')) return '/';
    // Prevent open redirect shenanigans like "/\\evil" (very conservative)
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

export default function LoginPage() {
  const params = useSearchParams();
  const router = useRouter();

  const callbackUrl = useMemo(
    () => sanitizeCallbackUrl(params.get('callbackUrl')),
    [params]
  );

  // NextAuth error code from the URL (e.g., ?error=CredentialsSignin)
  const urlError = params.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!urlError) return;
    setErrorMsg(ERROR_MAP[urlError] || ERROR_MAP.Default);
  }, [urlError]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);

    const trimmedEmail = email.trim();
    const trimmedPassword = password;

    if (!trimmedEmail || !trimmedPassword) {
      setErrorMsg('Please enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      // Requires a Credentials provider to be configured on the server.
      const res = await signIn('credentials', {
        email: trimmedEmail,
        password: trimmedPassword,
        redirect: false, // handle success/error manually
        callbackUrl,
      });

      if (!res) {
        setErrorMsg('No response from server. Please try again.');
        return;
      }

      if (res.error) {
        setErrorMsg(ERROR_MAP[res.error] || res.error || ERROR_MAP.Default);
        return;
      }

      // Success: go to the provided url or the sanitized callbackUrl
      router.push(res.url || callbackUrl);
    } catch (err) {
      setErrorMsg('Unexpected error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className='min-h-[60vh] flex items-center justify-center p-6'>
      <div className='w-full max-w-md space-y-6 rounded-xl border border-black/10 p-6 bg-white'>
        <h1 className='text-lg font-semibold'>Sign in</h1>

        {errorMsg && (
          <div className='alert alert-error text-sm'>{errorMsg}</div>
        )}

        <form onSubmit={onSubmit} className='space-y-3'>
          <div>
            <label className='label'>Email</label>
            <input
              className='input w-full'
              type='email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete='email'
              required
              disabled={submitting}
            />
          </div>
          <div>
            <label className='label'>Password</label>
            <input
              className='input w-full'
              type='password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete='current-password'
              required
              disabled={submitting}
            />
          </div>
          <button
            className='btn btn-primary w-full'
            type='submit'
            disabled={submitting}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className='text-center text-sm text-gray-500'>or</div>

        <div className='grid gap-2'>
          <button
            className='btn w-full'
            onClick={() => signIn('google', { callbackUrl })}
            disabled={submitting}
          >
            Continue with Google
          </button>

          {/* Hide Apple if you haven't configured it yet.
             To toggle from env: set NEXT_PUBLIC_ENABLE_APPLE=true in Vercel. */}
          {process.env.NEXT_PUBLIC_ENABLE_APPLE === 'true' && (
            <button
              className='btn w-full'
              onClick={() => signIn('apple', { callbackUrl })}
              title='Apple Sign-in requires HTTPS (use a tunnel in dev)'
              disabled={submitting}
            >
              Continue with Apple
            </button>
          )}
        </div>

        <p className='text-xs text-gray-500'>
          You’ll be redirected to:{' '}
          <span className='font-mono'>{callbackUrl}</span>
        </p>
      </div>
    </div>
  );
}
