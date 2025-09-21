'use client';
import { FormEvent, useState, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
  const params = useSearchParams();
  const router = useRouter();
  const callbackUrl = params.get('callbackUrl') || '/';
  const urlError = params.get('error'); // NextAuth error code (e.g., CredentialsSignin)

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Map NextAuth error codes to friendly messages
  useEffect(() => {
    if (!urlError) return;
    const map: Record<string, string> = {
      OAuthSignin: 'Could not sign in with the provider.',
      OAuthCallback: 'Provider callback failed.',
      OAuthCreateAccount: 'Could not create account with the provider.',
      EmailCreateAccount: 'Could not create account with email.',
      CallbackRouteError: 'Authentication callback failed.',
      AccessDenied: 'Access denied.',
      Verification: 'Verification failed.',
      CredentialsSignin: 'Invalid email or password.',
      Default: 'Unexpected error. Please try again.',
    };
    setErrorMsg(map[urlError] || 'Sign in failed.');
  }, [urlError]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    const res = await signIn('credentials', {
      email,
      password,
      redirect: false, // handle redirect manually for better error UI
      callbackUrl,
    });
    setSubmitting(false);

    if (res?.error) {
      setErrorMsg(
        res.error === 'CredentialsSignin'
          ? 'Invalid email or password.'
          : res.error
      );
      return;
    }
    // Success: go to callbackUrl (or default)
    router.push(res?.url || callbackUrl);
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
          <button
            className='btn w-full'
            onClick={() => signIn('apple', { callbackUrl })}
            title='Apple Sign-in requires HTTPS (use a tunnel in dev)'
            disabled={submitting}
          >
            Continue with Apple
          </button>
        </div>

        <p className='text-xs text-gray-500'>
          You’ll be redirected to:{' '}
          <span className='font-mono'>{callbackUrl}</span>
        </p>
      </div>
    </div>
  );
}
