// lib/notify.ts
import twilio from 'twilio';
import 'server-only';

type EmailProgramSummary = {
  name: string;
  category?: string;
  durationMinutes?: number | null;
};

type AdminEmailArgs = {
  bookingId: string;
  title: string;
  date: string;
  startLocal: string;
  endLocal: string;
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hallName: string | null;
  address: string | null;
  attendees: number;
  requesterName: string;
  requesterEmail: string | null;
  requesterPhone: string;
  notes: string | null;
  sourceLabel: string;
  manageUrl: string | null;
  programs?: EmailProgramSummary[];
};

type CustomerEmailArgs = {
  bookingId: string;
  title: string;
  date: string;
  startLocal: string;
  endLocal: string;
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hallName: string | null;
  address: string | null;
  attendees: number;
  programs?: EmailProgramSummary[];
};

type BookingTextArgs = {
  bookingId: string;
  title: string;
  date: string;
  startLocal: string;
  endLocal: string;
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hallName: string | null;
  address: string | null;
  programs?: EmailProgramSummary[];
};

function fmtLocation(
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA',
  hallName: string | null,
  address: string | null
) {
  if (locationType === 'GURDWARA') {
    return hallName ? `Gurdwara — ${hallName}` : 'Gurdwara';
  }
  return address ? `Outside — ${address}` : 'Outside booking';
}

function fmtPrograms(programs?: EmailProgramSummary[]) {
  if (!programs?.length) return '<em>No specific program types recorded.</em>';
  return programs
    .map((p) => {
      const dur =
        typeof p.durationMinutes === 'number' && p.durationMinutes > 0
          ? ` (${p.durationMinutes} min)`
          : '';
      const cat = p.category ? ` [${p.category}]` : '';
      return `<li>${p.name}${cat}${dur}</li>`;
    })
    .join('');
}

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

export function renderBookingEmailAdmin(args: AdminEmailArgs): string {
  const {
    bookingId,
    title,
    date,
    startLocal,
    endLocal,
    locationType,
    hallName,
    address,
    attendees,
    requesterName,
    requesterEmail,
    requesterPhone,
    notes,
    sourceLabel,
    manageUrl,
    programs,
  } = args;

  const where = fmtLocation(locationType, hallName, address);

  return `
  <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height:1.5;">
    <h2 style="margin-bottom:0.5rem;">New Booking Request</h2>
    <p style="margin-top:0;">Source: <strong>${sourceLabel}</strong></p>
    <p><strong>Booking ID:</strong> ${bookingId}</p>

    <h3>Event Details</h3>
    <p><strong>Title:</strong> ${title}</p>
    <p><strong>Date:</strong> ${date}</p>
    <p><strong>Time:</strong> ${startLocal} – ${endLocal}</p>
    <p><strong>Location:</strong> ${where}</p>
    <p><strong>Expected attendees:</strong> ${attendees}</p>

    <h3>Program(s)</h3>
    <ul>
      ${fmtPrograms(programs)}
    </ul>

    <h3>Requester</h3>
    <p><strong>Name:</strong> ${requesterName}</p>
    <p><strong>Phone:</strong> ${requesterPhone}</p>
    <p><strong>Email:</strong> ${requesterEmail ?? '—'}</p>

    ${
      notes
        ? `<h3>Notes</h3>
           <p>${notes.replace(/\n/g, '<br/>')}</p>`
        : ''
    }

    ${
      manageUrl
        ? `<p style="margin-top:1.5rem;">
             <a href="${manageUrl}" style="display:inline-block;padding:0.5rem 0.9rem;border-radius:4px;background:#0f766e;color:white;text-decoration:none;font-weight:500;">
               Open in admin
             </a>
           </p>`
        : ''
    }
  </div>
  `;
}

export function renderBookingEmailCustomer(args: CustomerEmailArgs): string {
  const {
    bookingId,
    title,
    date,
    startLocal,
    endLocal,
    locationType,
    hallName,
    address,
    attendees,
    programs,
  } = args;

  const where = fmtLocation(locationType, hallName, address);

  return `
  <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height:1.5;">
    <h2 style="margin-bottom:0.5rem;">Thank you – your booking was received</h2>
    <p style="margin-top:0;">Your booking ID is <strong>${bookingId}</strong>. Please keep this for reference.</p>

    <h3>Event Details</h3>
    <p><strong>Title:</strong> ${title}</p>
    <p><strong>Date:</strong> ${date}</p>
    <p><strong>Time:</strong> ${startLocal} – ${endLocal}</p>
    <p><strong>Location:</strong> ${where}</p>
    <p><strong>Expected attendees:</strong> ${attendees}</p>

    <h3>Requested program(s)</h3>
    <ul>
      ${fmtPrograms(programs)}
    </ul>

    <p style="margin-top:1.5rem;">
      The management team will review your request and contact you if any changes are needed.
    </p>
  </div>
  `;
}

export function renderBookingText(args: BookingTextArgs): string {
  const {
    bookingId,
    title,
    date,
    startLocal,
    endLocal,
    locationType,
    hallName,
    address,
    programs,
  } = args;

  const where = fmtLocation(locationType, hallName, address);
  const progLine = programs?.length
    ? `Programs: ${programs.map((p) => p.name).join(', ')}`
    : '';

  return [
    `Your booking request was received (ID: ${bookingId}).`,
    `"${title}" on ${date}, ${startLocal}–${endLocal}.`,
    `Location: ${where}.`,
    progLine,
    'Booking Hall/Time is subject to change & we will confirm after review.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderBookingEmailCustomerConfirmed(p: {
  title: string;
  date: string;
  startLocal: string;
  endLocal: string;
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hallName?: string | null;
  address?: string | null;
  programs?: EmailProgramSummary[];
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

  const programsBlock =
    p.programs && p.programs.length
      ? `
        <h3>Program(s)</h3>
        <ul>
          ${fmtPrograms(p.programs)}
        </ul>
      `
      : '';

  return `
    <p><strong>KW Gurdwara&nbsp;GTSA</strong></p>
    <p>Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh.</p>
    <h2>Your booking has been confirmed</h2>

    <p><strong>${p.title}</strong></p>
    <p>${p.date} ${p.startLocal} – ${p.endLocal}</p>
    <p>${where}</p>
    ${programsBlock}

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
  programs?: EmailProgramSummary[];
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

  const progLine =
    p.programs && p.programs.length
      ? `Program(s): ${p.programs.map((pr) => pr.name).join(', ')}\n`
      : '';

  return (
    `KW Gurdwara GTSA\n` +
    `Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh.\n` +
    `Your booking is confirmed: ${p.title}\n` +
    `${p.date} ${p.startLocal}-${p.endLocal}\n` +
    `${where}\n` +
    progLine +
    `Please arrive 10–15 minutes early.\n` +
    contactLine
  );
}