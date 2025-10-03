
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
const twilioClient = twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;

function safeSendOk() {
  if (!ENABLED) return false;
  if (IN_DEV && !ALLOW_IN_DEV) return false;
  return true;
}

function fmt(dt: Date) {
  try { return format(dt, "EEE, MMM d yyyy, h:mm a"); } catch { return dt.toString(); }
}

function locationLine(booking: {
  locationType: "GURDWARA" | "OUTSIDE_GURDWARA";
  hall?: { name: string } | null;
  address?: string | null;
}) {
  if (booking.locationType === "GURDWARA") {
    return booking.hall?.name ? `Gurdwara — ${booking.hall.name}` : "Gurdwara";
  }
  return booking.address ? `Outside — ${booking.address}` : "Outside";
}

// runtime check: does Staff have email/phone columns?
async function contactMapForStaffIds(ids: string[]) {
  const out = new Map<string, { email?: string | null; phone?: string | null }>();
  if (!ids.length) return out;

  const hasCol = async (col: string) => {
    const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Staff' AND column_name=${col}
      ) AS "exists"`;
    return rows?.[0]?.exists === true;
  };
  const hasEmail = await hasCol("email");
  const hasPhone = await hasCol("phone");
  if (!hasEmail && !hasPhone) return out;

  const cols = ["id"];
  if (hasEmail) cols.push("email");
  if (hasPhone) cols.push("phone");

  // raw query to avoid TS schema mismatch when columns are absent
  const raw = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${cols.join(",")} FROM "Staff" WHERE id = ANY($1)`, ids
  );
  for (const r of raw) out.set(r.id, { email: r.email ?? null, phone: r.phone ?? null });
  return out;
}

/**
 * Notify staff of newly-created assignments.
 * Matches your current schema: Booking(start/end), BookingItem, Staff, BookingAssignment(staffId, bookingItemId).
 */
export async function notifyAssignmentsStaff(
  bookingId: string,
  created: { staffId: string; bookingItemId: string }[]
) {
  if (!created?.length) return { sent: 0, dryRun: true };

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      items: { include: { programType: true } },
      hall: { select: { name: true } },
    },
  });
  if (!booking) return { sent: 0, dryRun: true };

  const staffIds = Array.from(new Set(created.map((c) => c.staffId)));
  const staff = await prisma.staff.findMany({
    where: { id: { in: staffIds } },
    select: { id: true, name: true },
  });
  const contacts = await contactMapForStaffIds(staffIds);
  const staffMap = new Map(staff.map((s) => [s.id, s]));

  const loc = locationLine({
    locationType: booking.locationType as any,
    hall: booking.hall,
    address: booking.address,
  });

  const byStaff = new Map<string, { programNames: string[]; roles: string[]; lines: string[] }>();
  for (const sId of staffIds) byStaff.set(sId, { programNames: [], roles: [], lines: [] });

  for (const a of created) {
    const it = booking.items.find((i) => i.id === a.bookingItemId);
    if (!it) continue;
    const role =
      it.programType.category === "PATH"
        ? "Path"
        : it.programType.category === "KIRTAN"
        ? "Kirtan"
        : it.programType.category;
    const entry = byStaff.get(a.staffId)!;
    entry.programNames.push(it.programType.name);
    entry.roles.push(role);
    entry.lines.push(`${role} — ${it.programType.name}`);
  }

  const dryRun = !safeSendOk();
  let sent = 0;

  for (const sId of staffIds) {
    const s = staffMap.get(sId);
    if (!s) continue;
    const info = byStaff.get(sId)!;
    if (!info.lines.length) continue;

    const subject = `[Assigned] ${booking.title} (${fmt(booking.start)})`;
    const html = `
      <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
        <h2>New Assignment</h2>
        <p><b>Event:</b> ${booking.title}</p>
        <p><b>When:</b> ${fmt(booking.start)} – ${fmt(booking.end)}</p>
        <p><b>Location:</b> ${loc}</p>
        <p><b>You are assigned to:</b></p>
        <ul>${info.lines.map((l) => `<li>${l}</li>`).join("")}</ul>
        <p>Vaheguru Ji Ka Khalsa, Vaheguru Ji Ki Fateh.</p>
      </div>
    `;
    const sms =
      `Assigned: ${booking.title}
` +
      `${fmt(booking.start)} - ${fmt(booking.end)}
` +
      `${loc}
` +
      info.lines.join(", ");

    const contact = contacts.get(sId) || {};
    const toEmail = contact.email;
    const toPhone = contact.phone;

    if (dryRun) {
      console.log(
        `[DRY RUN] Would notify ${s.name}${toEmail ? " <" + toEmail + ">" : ""}${toPhone ? " " + toPhone : ""}:`,
        info.lines
      );
      continue;
    }

    if (canEmail && resend && toEmail) {
      try {
        await resend.emails.send({ from: fromEmail, to: toEmail, subject, html });
        sent++;
      } catch (e) {
        console.error("Resend email failed", e);
      }
    }
    if (canSms && twilioClient && toPhone && /^\+\d+$/.test(toPhone)) {
      if (!smsFrom) {
        console.warn("ASSIGN_NOTIFY: TWILIO_SMS_FROM is empty; skipping SMS for", toPhone);
      } else {
        try {
          await twilioClient.messages.create({ from: smsFrom, to: toPhone, body: sms });
          sent++;
        } catch (e) {
          console.error("Twilio SMS failed", e);
        }
      }
    }
  }
  return { sent, dryRun };
}

// Backward-compatible alias if older code imports { notifyAssignments }:
export const notifyAssignments = notifyAssignmentsStaff;
