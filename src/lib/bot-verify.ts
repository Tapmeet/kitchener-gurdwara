export async function verifyTurnstile(token: string | null) {
  try {
    if (!token) return false;
    const secret = process.env.TURNSTILE_SECRET_KEY!;
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
      }
    );
    const json = await res.json();
    return !!json?.success;
  } catch {
    return false;
  }
}
