// lib/notify.ts
// Email via Resend HTTP API. SMS via Twilio.

import twilio from 'twilio';
import 'server-only';

// ---- Resend (Email) ----
const resendKey = process.env.RESEND_API_KEY;
const resendFrom = process.env.BOOKINGS_FROM_EMAIL;

export const NOTIFY = Object.freeze({
  adminInbox: process.env.BOOKINGS_INBOX_EMAIL ?? '',
});

// ---- Twilio SMS (single From number) ----
const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
const twilioSmsFrom = process.env.TWILIO_SMS_FROM;

const twilioClient =
  twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

const BOOKING_CONTACT_NAME =
  process.env.BOOKING_CONTACT_NAME ||
  process.env.ASSIGN_NOTIFY_CONTACT_NAME ||
  'the Gurdwara office';

const BOOKING_CONTACT_PHONE =
  process.env.BOOKING_CONTACT_PHONE ||
  process.env.ASSIGN_NOTIFY_CONTACT_PHONE ||
  '';

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
}): Promise<{ id?: string }> {
  // Fail loudly so you see it in logs, rather than silently skipping
  if (!resendKey) throw new Error('RESEND_API_KEY is missing');
  if (!resendFrom) throw new Error('BOOKINGS_FROM_EMAIL is missing');

  const to = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map((s) => s?.trim())
    .filter(Boolean);
  if (!to.length) throw new Error('No recipients provided');

  // Slightly longer timeout; Resend can take >4s occasionally
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch('https://api.resend.com/emails', {
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
      // Keepalive is safe on Node runtime; avoids some network flakiness
      keepalive: true as any,
    });

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      // Surface the exact failure (401 bad key, 403 domain not verified, 422 invalid "from"/"to", etc.)
      throw new Error(
        `Resend failed ${res.status} ${res.statusText}: ${JSON.stringify(body)}`
      );
    }
    return { id: (body as any)?.id };
  } catch (err: any) {
    // Log once with full detail, then bubble up so API route can decide to ignore or handle
    console.error('Resend email error:', err?.message ?? err);
    throw err;
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
  requesterName?: string | null;
  requesterEmail?: string | null;
  requesterPhone?: string | null;
  notes?: string | null;
  sourceLabel?: string | null; // e.g. "Public form"
  manageUrl?: string | null; // admin link, if you have one
}) {
  const where =
    p.locationType === 'GURDWARA'
      ? p.hallName
        ? `Hall: ${p.hallName}`
        : 'Gurdwara'
      : p.address
        ? p.address
        : 'Outside location (address not provided)';

  const requesterLines = [
    p.requesterName && `<li><b>Name:</b> ${p.requesterName}</li>`,
    p.requesterEmail && `<li><b>Email:</b> ${p.requesterEmail}</li>`,
    p.requesterPhone && `<li><b>Phone:</b> ${p.requesterPhone}</li>`,
  ]
    .filter(Boolean)
    .join('');

  const notesBlock = p.notes
    ? `<p><b>Notes from requester:</b><br/>${p.notes}</p>`
    : '';

  const sourceLine = p.sourceLabel
    ? `<p><b>Source:</b> ${p.sourceLabel}</p>`
    : '';

  const manageLine = p.manageUrl
    ? `<p><a href="${p.manageUrl}">Open this booking in the admin dashboard</a></p>`
    : '';

  return `
    <p>Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh.</p>
    <h2>New booking request</h2>

    <p><b>Event:</b> ${p.title}</p>
    <p><b>When:</b> ${p.date} ${p.startLocal} – ${p.endLocal}</p>
    <p><b>Location:</b> ${where}</p>

    <h3>Requester details</h3>
    <ul>
      ${requesterLines || '<li>(no contact details provided)</li>'}
    </ul>

    ${notesBlock}
    ${sourceLine}
    ${manageLine}

    <p>Please review and confirm or follow up with the requester.</p>
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

  const contactLine = BOOKING_CONTACT_PHONE
    ? `If you need to update or cancel your request, please contact ${BOOKING_CONTACT_NAME} at ${BOOKING_CONTACT_PHONE}.`
    : `If you need to update or cancel your request, please contact ${BOOKING_CONTACT_NAME}.`;

  return `
    <p>Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh.</p>
    <h2>Thank you — your booking request has been received</h2>

    <p><strong>${p.title}</strong></p>
    <p>${p.date} ${p.startLocal} – ${p.endLocal}</p>
    <p>${where}</p>

    <p>We will review your request and confirm the booking with you soon.</p>
    <p>${contactLine}</p>
  `;
}

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

  const contactLine = BOOKING_CONTACT_PHONE
    ? `If you need changes, contact ${BOOKING_CONTACT_NAME} at ${BOOKING_CONTACT_PHONE}.`
    : `If you need changes, contact ${BOOKING_CONTACT_NAME}.`;

  return (
    `Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh.\n` +
    `Booking request received: ${p.title}\n` +
    `${p.date} ${p.startLocal}-${p.endLocal}\n` +
    `${where}\n` +
    `We will confirm your booking with you soon.\n` +
    contactLine
  );
}

export function renderBookingEmailCustomerConfirmed(p: {
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

  const contactLine = BOOKING_CONTACT_PHONE
    ? `If you need to change or cancel this booking, please contact ${BOOKING_CONTACT_NAME} at ${BOOKING_CONTACT_PHONE}.`
    : `If you need to change or cancel this booking, please contact ${BOOKING_CONTACT_NAME}.`;

  return `
    <p>Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh.</p>
    <h2>Your booking has been confirmed</h2>

    <p><strong>${p.title}</strong></p>
    <p>${p.date} ${p.startLocal} – ${p.endLocal}</p>
    <p>${where}</p>

    <p>Please arrive 10–15 minutes early and speak to the coordinator if needed.</p>
    <p>${contactLine}</p>
    <p>Thank you.</p>
  `;
}

export function renderBookingTextConfirmed(p: {
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

  const contactLine = BOOKING_CONTACT_PHONE
    ? `If you need changes, contact ${BOOKING_CONTACT_NAME} at ${BOOKING_CONTACT_PHONE}.`
    : `If you need changes, contact ${BOOKING_CONTACT_NAME}.`;

  return (
    `Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh.\n` +
    `Your booking is confirmed: ${p.title}\n` +
    `${p.date} ${p.startLocal}-${p.endLocal}\n` +
    `${where}\n` +
    `Please arrive 10–15 minutes early.\n` +
    contactLine
  );
}
