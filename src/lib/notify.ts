// lib/notify.ts
// Email via Resend HTTP API. SMS via Twilio.

import twilio from 'twilio';

// ---- Resend (Email) ----
const resendKey = process.env.RESEND_API_KEY;
const resendFrom = process.env.BOOKINGS_FROM_EMAIL; // e.g. "Gurdwara <onboarding@resend.dev>"
export const NOTIFY = Object.freeze({
  adminInbox: process.env.BOOKINGS_INBOX_EMAIL ?? '',
});

// ---- Twilio SMS (single From number) ----
const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
const twilioSmsFrom = process.env.TWILIO_SMS_FROM;

const twilioClient =
  twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

// ---------- utils ----------
function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function parseAdminEmails(): string[] {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(/[,;\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const inbox = process.env.BOOKINGS_INBOX_EMAIL?.trim();
  if (inbox) list.push(inbox);
  return uniq(list);
}

function isE164(s: string): boolean {
  // +[7-15 digits] (ITU E.164)
  return /^\+\d{7,15}$/.test(s);
}

// ---------- Emails ----------
export function getAdminEmails(): string[] {
  return parseAdminEmails();
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<void> {
  if (!resendKey || !resendFrom) return;

  const to = Array.isArray(opts.to) ? opts.to : [opts.to];
  if (!to.length) return;

  // Short timeout so bookings don’t hang on email latency
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resendFrom,
        to,
        subject: opts.subject,
        html: opts.html,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    console.warn(
      'Resend email failed (ignored):',
      (err as any)?.message ?? err
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- SMS (Twilio) ----------
export async function sendSms({
  toE164,
  text,
}: {
  toE164: string;
  text: string;
}): Promise<void> {
  // Preserve format EXACTLY as passed in `text`
  if (!twilioClient || !twilioSmsFrom) return;
  // Normalize recipient (trim spaces) but require valid E.164
  const to = toE164.replace(/\s+/g, '');
  console.log(to);
  if (!isE164(to)) {
    console.warn('Invalid E.164, skipping SMS:', toE164);
    return;
  }
  if (!text || !text.trim()) return;

  try {
    await twilioClient.messages.create({
      to,
      from: twilioSmsFrom,
      body: text,
    });
  } catch (err: any) {
    // Don’t break booking flow — just log
    console.error('Twilio SMS failed (ignored):', {
      status: err?.status,
      code: err?.code,
      message: err?.message,
      moreInfo: err?.moreInfo,
    });
  }
}

/* -------- message bodies (email + SMS) -------- */

export function renderBookingEmailAdmin(p: {
  title: string;
  date: string;
  startLocal: string;
  endLocal: string;
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hallName?: string | null;
  address?: string | null;
  contactName: string;
  contactPhone: string;
  attendees?: number;
}) {
  const where =
    p.locationType === 'GURDWARA'
      ? p.hallName
        ? `Hall: ${p.hallName}`
        : 'Gurdwara'
      : `Address: ${p.address ?? ''}`;

  return `
    <h2>New Path/Kirtan Booking</h2>
    <p><strong>${p.title}</strong></p>
    <p>${p.date} ${p.startLocal} – ${p.endLocal}</p>
    <p>${where}</p>
    <p>Attendees: ${p.attendees ?? '—'}</p>
    <p>Contact: ${p.contactName} (${p.contactPhone})</p>
  `;
}

export function renderBookingEmailCustomer(p: {
  title: string;
  date: string;
  startLocal: string;
  endLocal: string;
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hallName?: string | null;
  address?: string | null;
}) {
  const where =
    p.locationType === 'GURDWARA'
      ? p.hallName
        ? `Hall: ${p.hallName}`
        : 'Gurdwara'
      : `Address: ${p.address ?? ''}`;

  return `
    <h2>Thank you — your booking is received</h2>
    <p><strong>${p.title}</strong></p>
    <p>${p.date} ${p.startLocal} – ${p.endLocal}</p>
    <p>${where}</p>
    <p>We’ll confirm details with you soon.</p>
  `;
}

// Generic text body reused for SMS (FORMAT UNCHANGED)
export function renderBookingText(p: {
  title: string;
  date: string;
  startLocal: string;
  endLocal: string;
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hallName?: string | null;
  address?: string | null;
}) {
  const where =
    p.locationType === 'GURDWARA'
      ? p.hallName
        ? `Hall: ${p.hallName}`
        : 'Gurdwara'
      : `Address: ${p.address ?? ''}`;
  return `✅ Booking received
${p.title}
${p.date} ${p.startLocal}–${p.endLocal}
${where}
We’ll confirm with you soon.`;
}
