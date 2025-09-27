// src/lib/phone.ts
import { AsYouType, parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

// Pick your default region (only used when user *doesn't* type a +country code)
export const DEFAULT_REGION: CountryCode = 'CA'; // change to 'IN', 'US', etc. if you want

// Format nicely as user types. If they start with '+', we format internationally.
export function formatPhoneLive(
  input: string,
  defaultRegion: CountryCode = DEFAULT_REGION
) {
  const cleaned = input.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  const ayt = new AsYouType(
    cleaned.startsWith('+') ? undefined : defaultRegion
  );
  return ayt.input(cleaned);
}

// Convert to strict E.164 on submit. Returns '' if invalid.
export function toE164Generic(
  input: string,
  defaultRegion: CountryCode = DEFAULT_REGION
): string {
  const raw = input.trim();
  const parsed = raw.startsWith('+')
    ? parsePhoneNumberFromString(raw)
    : parsePhoneNumberFromString(raw, defaultRegion);

  return parsed?.isValid() ? parsed.number : '';
}
