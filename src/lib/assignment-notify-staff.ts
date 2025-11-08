// src/lib/assignment-notify-staff.ts
import { prisma } from '@/lib/db';
import { Resend } from 'resend';
import twilio from 'twilio';
import { fmtInVenue, DATE_TIME_FMT } from '@/lib/time';

const ENABLED = process.env.ASSIGN_NOTIFICATIONS === '1';
const CHANNELS = (process.env.ASSIGN_NOTIFY_CHANNELS || 'both').toLowerCase();
const IN_DEV = process.env.NODE_ENV !== 'production';
const ALLOW_IN_DEV = process.env.ASSIGN_NOTIFY_IN_DEV === '1';

const canEmail = CHANNELS === 'email' || CHANNELS === 'both';
const canSms = CHANNELS === 'sms' || CHANNELS === 'both';

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const fromEmail =
  process.env.BOOKINGS_FROM_EMAIL || 'Gurdwara <noreply@example.com>';
const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;
const smsFrom = process.env.TWILIO_SMS_FROM || '';
const CONTACT_NAME = process.env.ASSIGN_NOTIFY_CONTACT_NAME || 'Tapmeet Singh';
const CONTACT_PHONE = process.env.ASSIGN_NOTIFY_CONTACT_PHONE || '+14379864490';

function okToSend() {
  if (!ENABLED) return false;
  if (IN_DEV && !ALLOW_IN_DEV) return false;
  return true;
}

function fmt(d: Date | string | number) {
  try {
    return fmtInVenue(d, DATE_TIME_FMT);
  } catch {
    const date = d instanceof Date ? d : new Date(d as any);
    return date.toString();
  }
}

function buildLocationLine(b: {
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hall?: { name: string } | null;
  address?: string | null;
}) {
  if (b.locationType === 'GURDWARA')
    return b.hall?.name ? `Gurdwara — ${b.hall.name}` : 'Gurdwara';
  return b.address ? `Outside — ${b.address}` : 'Outside';
}

/**
 * Notify staff after auto-assign.
 * created[] expects Staff IDs and BookingItem IDs (your current schema).
 */
export async function notifyAssignmentsStaff(
  bookingId: string,
  created: { staffId: string; bookingItemId: string }[]
) {
  if (!created?.length) return { sent: 0, dryRun: !okToSend() };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      items: { include: { programType: true } },
      hall: { select: { name: true } },
    },
  });
  if (!booking) return { sent: 0, dryRun: !okToSend() };

  const staffIds = Array.from(new Set(created.map((c) => c.staffId)));
  const staff = await prisma.staff.findMany({
    where: { id: { in: staffIds } },
    select: { id: true, name: true, email: true, phone: true },
  });
  const staffMap = new Map(staff.map((s) => [s.id, s]));

  const locLine = buildLocationLine({
    locationType: booking.locationType as any,
    hall: booking.hall,
    address: booking.address,
  });

  // Aggregate per staff
  const byStaff = new Map<string, { lines: string[] }>();
  for (const sId of staffIds) byStaff.set(sId, { lines: [] });
  for (const a of created) {
    const it = booking.items.find((i) => i.id === a.bookingItemId);
    if (!it) continue;
    const role =
      it.programType.category === 'PATH'
        ? 'Path'
        : it.programType.category === 'KIRTAN'
          ? 'Kirtan'
          : it.programType.category;
    byStaff.get(a.staffId)!.lines.push(`${role} — ${it.programType.name}`);
  }

  const dryRun = !okToSend();
  let sent = 0;

  for (const sId of staffIds) {
    const s = staffMap.get(sId);
    if (!s) continue;
    const lines = byStaff.get(sId)!.lines;
    if (!lines.length) continue;

    const subject = `Seva assignment – ${booking.title} (${fmt(booking.start)})`;

    // contact line used in both email + SMS
    const contactLine = CONTACT_PHONE
      ? `If you cannot attend, please contact ${CONTACT_NAME} at ${CONTACT_PHONE}.`
      : `If you cannot attend, please contact ${CONTACT_NAME}.`;

    const html = `<div style="font-family:system-ui,Segoe UI,Roboto,Arial">
  <h2>New Seva Assignment</h2>
  <p>Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh 🙏</p>
  <p><b>Event:</b> ${booking.title}</p>
  <p><b>When:</b> ${fmt(booking.start)} – ${fmt(booking.end)}</p>
  <p><b>Location:</b> ${locLine}</p>
  <p><b>Your seva:</b></p>
  <ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
  <p>${contactLine}</p>
  <p>Thank you for your seva.</p>
</div>`;

    const smsLines = [
      'Waheguru Ji Ka Khalsa, Waheguru Ji Ki Fateh 🙏',
      `You have been assigned seva for "${booking.title}".`,
      `When: ${fmt(booking.start)} – ${fmt(booking.end)}`,
      `Location: ${locLine}`,
      `Seva: ${lines.join(', ')}`,
      contactLine,
    ];

    const sms = smsLines.join('\n');

    if (dryRun) {
      console.log(
        `[DRY RUN] Would notify ${s.name}${s.email ? ' <' + s.email + '>' : ''}${
          s.phone ? ' ' + s.phone : ''
        }:`,
        lines
      );
      continue;
    }

    if (canEmail && resend && s.email) {
      try {
        await resend.emails.send({
          from: fromEmail,
          to: s.email,
          subject,
          html,
        });
        sent++;
      } catch (e) {
        console.error('Resend email failed', e);
      }
    }
    if (canSms && twilioClient && s.phone && /^\+\d+$/.test(s.phone)) {
      if (!smsFrom)
        console.warn(
          'ASSIGN_NOTIFY: TWILIO_SMS_FROM is empty; skipping SMS for',
          s.phone
        );
      else {
        try {
          await twilioClient.messages.create({
            from: smsFrom,
            to: s.phone,
            body: sms,
          });
          sent++;
        } catch (e) {
          console.error('Twilio SMS failed', e);
        }
      }
    }
  }
  return { sent, dryRun };
}

// Backward-compatible alias
export const notifyAssignments = notifyAssignmentsStaff;
