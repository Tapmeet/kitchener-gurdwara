import { prisma } from "@/lib/db";
import { format } from "date-fns";
import twilio from "twilio";
import { Resend } from "resend";

const ENABLED = process.env.ASSIGN_NOTIFICATIONS === "1";
const CHANNELS = (process.env.ASSIGN_NOTIFY_CHANNELS || "both").toLowerCase();
const IN_DEV = process.env.NODE_ENV !== "production";
const ALLOW_IN_DEV = process.env.ASSIGN_NOTIFY_IN_DEV === "1";

const resendKey = process.env.RESEND_API_KEY || "";
const fromEmail = process.env.BOOKINGS_FROM_EMAIL || "Gurdwara <noreply@example.com>";
const twilioSid = process.env.TWILIO_ACCOUNT_SID || "";
const twilioToken = process.env.TWILIO_AUTH_TOKEN || "";
const smsFrom = process.env.TWILIO_SMS_FROM || "";

const canEmail = CHANNELS === "email" || CHANNELS === "both";
const canSms = CHANNELS === "sms" || CHANNELS === "both";

const resend = resendKey ? new Resend(resendKey) : null;
const twilioClient = (twilioSid && twilioToken) ? twilio(twilioSid, twilioToken) : null;

function safeSendOk() {
  if (!ENABLED) return false;
  if (IN_DEV && !ALLOW_IN_DEV) return false;
  return true;
}

function fmt(dt: Date) {
  try { return format(dt, "EEE, MMM d yyyy, h:mm a"); } catch { return dt.toString(); }
}

function mkEmailHtml(opts: { programName?: string | null; startAt: Date; endAt: Date; role: string; note?: string }) {
  return `
  <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
    <h2>New Assignment — ${opts.role}</h2>
    <p><b>Program:</b> ${opts.programName ?? "Program"}</p>
    <p><b>When:</b> ${fmt(opts.startAt)} – ${fmt(opts.endAt)}</p>
    ${opts.note ? `<p>${opts.note}</p>` : ""}
    <p>Vaheguru Ji Ka Khalsa, Vaheguru Ji Ki Fateh.</p>
  </div>
  `;
}

function mkSmsBody(opts: { programName?: string | null; startAt: Date; endAt: Date; role: string }) {
  return `Assigned (${opts.role}) — ${opts.programName ?? "Program"}
${fmt(opts.startAt)} - ${fmt(opts.endAt)}
Reply if unavailable.`;
}

export async function notifyAssignments(bookingId: string, created: { userId: string; role: "PATH" | "KIRTAN"; teamId?: string }[]) {
  if (!created?.length) return { sent: 0 };
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { programType: true },
  });
  if (!booking) return { sent: 0 };
  const programName = booking.programType?.name ?? "Program";

  // Load distinct users
  const userIds = Array.from(new Set(created.map(c => c.userId)));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, name: true, phone: true },
  });
  const uMap = new Map(users.map(u => [u.id, u]));

  let sent = 0;

  for (const a of created) {
    const u = uMap.get(a.userId);
    if (!u) continue;
    const role = a.role === "PATH" ? "Path" : "Kirtan";
    const emailHtml = mkEmailHtml({ programName, startAt: booking.startAt, endAt: booking.endAt, role });
    const emailSubject = `[Assigned] ${role} — ${programName} (${fmt(booking.startAt)})`;
    const smsBody = mkSmsBody({ programName, startAt: booking.startAt, endAt: booking.endAt, role });

    if (!safeSendOk()) {
      // Dry-run log
      console.log(`[DRY RUN] Would notify ${u.email || u.phone || u.id}: ${role} for ${programName}`);
      continue;
    }

    // Email
    if (canEmail && resend && u.email) {
      try {
        await resend.emails.send({
          from: fromEmail,
          to: u.email,
          subject: emailSubject,
          html: emailHtml,
        });
        sent++;
      } catch (e) {
        console.error("Resend email failed", e);
      }
    }

    // SMS (E.164 only)
    if (canSms && twilioClient && u.phone && /^\+[\d]+$/.test(u.phone)) {
      try {
        await twilioClient.messages.create({
          from: smsFrom,
          to: u.phone,
          body: smsBody,
        });
        sent++;
      } catch (e) {
        console.error("Twilio SMS failed", e);
      }
    }
  }

  return { sent };
}
