// lib/notify.ts
// Email via Resend HTTP API. WhatsApp via Twilio.

import twilio from 'twilio';

const resendKey = process.env.RESEND_API_KEY;
const resendFrom = process.env.BOOKINGS_FROM_EMAIL; // e.g. "Gurdwara <onboarding@resend.dev>"
export const NOTIFY = { adminInbox: process.env.BOOKINGS_INBOX_EMAIL };

const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
const twilioWhatsappFrom =
  process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886'; // Twilio sandbox default

const twilioClient =
  twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

function parseAdminEmails(): string[] {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(/[,;\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const inbox = process.env.BOOKINGS_INBOX_EMAIL?.trim();
  if (inbox) list.push(inbox);
  return Array.from(new Set(list));
}

export function getAdminEmails(): string[] {
  return parseAdminEmails();
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  if (!resendKey || !resendFrom) return;
  const to = Array.isArray(opts.to) ? opts.to : [opts.to];

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
    });
  } catch {
    // Best-effort only; don't crash booking flow
  }
}

export async function sendWhatsApp({
  toE164,
  text,
}: {
  toE164: string;
  text: string;
}) {
  if (!twilioClient || !twilioWhatsappFrom) return;
  await twilioClient.messages.create({
    from: twilioWhatsappFrom,
    to: `whatsapp:${toE164}`,
    body: text,
  });
}

/* -------- email bodies -------- */

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

export function renderBookingWhatsApp(p: {
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
