// src/app/api/bookings/route.ts

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { CreateBookingSchema } from '@/lib/validation';
import {
  VENUE_TZ,
  isWithinBusinessHours,
  hourSpan,
  BUSINESS_HOURS_24,
} from '@/lib/businessHours';
import { add, reqFromProgram, RoleVector, ROLES } from '@/lib/roles';
import { getMaxPerLocationPerRole, getTotalPoolPerRole } from '@/lib/pools';

import {
  sendEmail,
  renderBookingEmailAdmin,
  renderBookingEmailCustomer,
  sendSms,
  getAdminEmails,
  renderBookingText,
} from '@/lib/notify';
import { auth } from '@/lib/auth';
import { autoAssignForBooking } from '@/lib/auto-assign';
import { notifyAssignmentsStaff } from '@/lib/assignment-notify-staff';
import { getTotalUniqueStaffCount } from '@/lib/headcount';
import { getJathaGroups, JATHA_SIZE } from '@/lib/jatha';
import { pickFirstFittingHall, type TimeWindow } from '@/lib/halls';
import { ProgramCategory } from '@/generated/prisma/client';

const OUTSIDE_BUFFER_MS = 15 * 60 * 1000;
const ENFORCE_WHOLE_JATHA = process.env.ENFORCE_WHOLE_JATHA === '1';

const HOUR_MS = 60 * 60 * 1000;

function isSehajName(name: string | null | undefined) {
  return (name ?? '').toLowerCase().startsWith('sehaj path');
}

/**
 * Sehaj hall/staff windows:
 * - Always: first 60 minutes
 * - Sehaj Path: last 60 minutes
 * - Sehaj Path + Kirtan: last 120 minutes (merged)
 */
function hallWindowsForSehaj(
  start: Date,
  end: Date,
  withKirtan: boolean
): TimeWindow[] {
  if (end <= start) return [];

  const firstEnd = new Date(Math.min(start.getTime() + HOUR_MS, end.getTime()));
  const windows: TimeWindow[] = [{ start, end: firstEnd }];

  const durMs = end.getTime() - start.getTime();
  if (durMs <= HOUR_MS) return windows;

  const endMinutes = withKirtan ? 2 * HOUR_MS : HOUR_MS;
  const endStart = new Date(
    Math.max(start.getTime(), end.getTime() - endMinutes)
  );
  if (endStart < end) windows.push({ start: endStart, end });

  return windows;
}

function hallWindowsForPrograms(
  programs: Array<{ name?: string | null }>,
  start: Date,
  end: Date
): TimeWindow[] | undefined {
  const names = programs.map((p) => p.name ?? '');
  const hasSehaj = names.some((n) => isSehajName(n));
  if (!hasSehaj) return undefined;

  const mixed = names.some((n) => !isSehajName(n));
  if (mixed) return undefined; // be conservative

  const withKirtan = names.some((n) => n.toLowerCase().includes('kirtan'));
  return hallWindowsForSehaj(start, end, withKirtan);
}

/** Convert TimeWindow[] into business-hour buckets (union) */
function hoursForWindows(
  windows: TimeWindow[],
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA',
  outsideBufferMs: number
): number[] {
  const set = new Set<number>();

  for (const w of windows) {
    if (!w || w.end <= w.start) continue;

    const s =
      locationType === 'OUTSIDE_GURDWARA'
        ? new Date(w.start.getTime() - outsideBufferMs)
        : w.start;

    const e =
      locationType === 'OUTSIDE_GURDWARA'
        ? new Date(w.end.getTime() + outsideBufferMs)
        : w.end;

    for (const h of hourSpan(s, e)) {
      if (BUSINESS_HOURS_24.includes(h)) set.add(h);
    }
  }

  return Array.from(set).sort((a, b) => a - b);
}

/** Tight range used to query overlaps when we only care about Sehaj windows */
function rangeForWindows(
  windows: TimeWindow[],
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA',
  outsideBufferMs: number
) {
  let min = Infinity;
  let max = -Infinity;

  for (const w of windows) {
    if (!w || w.end <= w.start) continue;

    const s =
      locationType === 'OUTSIDE_GURDWARA'
        ? w.start.getTime() - outsideBufferMs
        : w.start.getTime();

    const e =
      locationType === 'OUTSIDE_GURDWARA'
        ? w.end.getTime() + outsideBufferMs
        : w.end.getTime();

    if (s < min) min = s;
    if (e > max) max = e;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { start: new Date(min), end: new Date(max) };
}

function padWindow(
  w: TimeWindow,
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA',
  outsideBufferMs: number
): TimeWindow {
  if (locationType !== 'OUTSIDE_GURDWARA') return w;
  return {
    start: new Date(w.start.getTime() - outsideBufferMs),
    end: new Date(w.end.getTime() + outsideBufferMs),
  };
}

function intersectWindow(a: TimeWindow, b: TimeWindow): TimeWindow | null {
  const s = a.start > b.start ? a.start : b.start;
  const e = a.end < b.end ? a.end : b.end;
  if (e <= s) return null;
  return { start: s, end: e };
}

const VERCEL_ENV = process.env.VERCEL_ENV; // 'preview' | 'production' | undefined
const NODE_ENV = process.env.NODE_ENV;

const isProdEnv =
  VERCEL_ENV === 'production' || (!VERCEL_ENV && NODE_ENV === 'production'); // non-Vercel prod fallback

const bookingNotificationsEnabled =
  process.env.BOOKING_NOTIFICATIONS_ENABLED !== '0';

const shouldSendBookingNotifications = isProdEnv && bookingNotificationsEnabled;

// ------------ lightweight rate limit (per-IP) -------------
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, limit = 10, windowMs = 60_000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count < limit) {
    b.count++;
    return true;
  }
  return false;
}

function isBusinessStartHourTZ(d: Date) {
  const hourStr = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    hour12: false,
    timeZone: VENUE_TZ,
  }).format(d);
  const h = parseInt(hourStr, 10);
  const start = Math.min(...BUSINESS_HOURS_24);
  const end = Math.max(...BUSINESS_HOURS_24) + 1;
  return h >= start && h < end;
}

// ------------ Turnstile server verification ---------------
async function verifyTurnstile(token: string | null) {
  // Bypass outside production or when disabled
  if (process.env.NODE_ENV !== 'production') return true;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const disabled =
    !secret ||
    ['false', '0', 'off', 'no'].includes(String(secret).toLowerCase());
  if (disabled) return true;
  if (!token) return false;

  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(
          token
        )}`,
      }
    );
    const json = (await res.json()) as { success?: boolean };
    return !!json?.success;
  } catch {
    return false;
  }
}

/** Helpers */
function toLocalParts(input: Date | string | number) {
  const d = input instanceof Date ? input : new Date(input);
  const date = d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: VENUE_TZ,
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: VENUE_TZ,
  });
  return { date, time };
}

// Hall helpers (priority & capacity inference) - (kept, even if unused in this file)
const HALL_PATTERNS = {
  small: /(^|\b)(small\s*hall|hall\s*2)(\b|$)/i,
  main: /(^|\b)(main\s*hall|hall\s*1)(\b|$)/i,
  upper: /(^|\b)(upper\s*hall)(\b|$)/i,
};
const CAP_DEFAULTS = { small: 125, main: 325, upper: 100 };

type CreatedBooking = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  locationType: 'GURDWARA' | 'OUTSIDE_GURDWARA';
  hallId: string | null;
  address: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  notes: string | null;
  attendees: number;
  hall: { name: string } | null;
  items: {
    id: string;
    programType: {
      name: string;
      category: ProgramCategory;
      durationMinutes: number | null;
    };
  }[];
};

export async function POST(req: Request) {
  try {
    // -------- rate-limit & bot check ----------
    const ip =
      (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ||
      'unknown';
    if (!rateLimit(`book:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    // token can be header or in body
    const cloned = req.clone();
    const bodyForToken = await cloned.json().catch(() => ({}) as any);
    const turnstileToken =
      req.headers.get('x-turnstile-token') ??
      bodyForToken?.turnstileToken ??
      null;
    const botOk = await verifyTurnstile(turnstileToken);
    if (!botOk) {
      return NextResponse.json(
        { error: 'Bot verification failed' },
        { status: 400 }
      );
    }

    // optional origin check (robust)
    const origin = req.headers.get('origin') ?? '';
    const allowedOrigin = process.env.NEXTAUTH_URL ?? '';
    if (allowedOrigin && origin) {
      try {
        const reqOrigin = new URL(origin).origin;
        const allowed = new URL(allowedOrigin).origin;
        if (reqOrigin !== allowed) {
          return NextResponse.json(
            { error: 'Invalid origin' },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json({ error: 'Invalid origin' }, { status: 400 });
      }
    }

    // session (best-effort)
    let session: any | null = null;
    try {
      session = await auth();
    } catch {
      session = null;
    }

    // validate payload
    const body =
      bodyForToken && Object.keys(bodyForToken).length
        ? bodyForToken
        : await req.json();
    const parsed = CreateBookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    if (input.locationType === 'OUTSIDE_GURDWARA' && !input.address?.trim()) {
      return NextResponse.json(
        { error: 'Address is required for outside bookings' },
        { status: 400 }
      );
    }

    const start = new Date(input.start);
    const end = new Date(input.end ?? input.start);

    if (end <= start) {
      return NextResponse.json(
        { error: 'End time must be after the start time.' },
        { status: 400 }
      );
    }

    // program types
    const ptIds = (input.items || []).map((i: any) => i.programTypeId);
    if (!ptIds.length) {
      return NextResponse.json(
        { error: 'At least one program must be selected.' },
        { status: 400 }
      );
    }

    const programs = await prisma.programType.findMany({
      where: { id: { in: ptIds } },
      select: {
        name: true,
        id: true,
        minPathers: true,
        minKirtanis: true,
        canBeOutsideGurdwara: true,
        requiresHall: true,
        peopleRequired: true,
        durationMinutes: true,
        // needed for trailing-kirtan server guard
        trailingKirtanMinutes: true,
        category: true,
      },
    });

    if (programs.length !== ptIds.length) {
      return NextResponse.json(
        { error: 'Invalid program types' },
        { status: 400 }
      );
    }

    if (
      input.locationType === 'OUTSIDE_GURDWARA' &&
      programs.some((p) => !p.canBeOutsideGurdwara)
    ) {
      return NextResponse.json(
        { error: 'One or more programs cannot be performed outside.' },
        { status: 400 }
      );
    }

    // ✅ Sehaj detection (Sehaj-only bookings)
    // If Sehaj: we only “block” hall/staff for start window + end window
    const sehajWindows = hallWindowsForPrograms(programs as any, start, end);
    const isSehajBooking =
      Array.isArray(sehajWindows) && sehajWindows.length > 0;

    // role vector required by these programs
    const required: RoleVector = programs.reduce(
      (acc, p) => add(acc, reqFromProgram(p as any)),
      { PATH: 0, KIRTAN: 0 }
    );

    // Headcount required (sum over items)
    const headcountRequired = programs
      .map((p) => {
        const minSum = (p.minPathers ?? 0) + (p.minKirtanis ?? 0);

        // Long pure-path programs (Akhand-style): don't treat peopleRequired as
        // "every hour needs a 5-person team". Concurrency is defined by min pathers.
        //
        // ✅ IMPORTANT: Exclude Sehaj from this shortcut.
        const isLongPathItem =
          p.category === ProgramCategory.PATH &&
          !isSehajName(p.name) &&
          (p.durationMinutes ?? 0) >= 36 * 60 && // 36h+ => multi-day
          (p.minKirtanis ?? 0) === 0;

        if (isLongPathItem) {
          return Math.max(minSum, 1);
        }

        return Math.max(p.peopleRequired ?? 0, minSum);
      })
      .reduce((a, b) => a + b, 0);

    // How long is this booking block?
    const bookingDurationMinutes = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 60_000)
    );
    const durationHours = Math.max(1, Math.ceil(bookingDurationMinutes / 60));

    const isLong = durationHours >= 36;
    const isPurePath = required.KIRTAN === 0;

    // ✅ LongPath (Akhand-style) is “long + pure path” BUT NOT Sehaj
    const isLongPath = isLong && isPurePath && !isSehajBooking;

    // Business-hours guard:
    // - Sehaj: validate only windows (start + end), not whole multi-day span
    // - Normal: validate whole span
    // - LongPath (Akhand-style): validate only start hour
    if (isSehajBooking) {
      for (const w of sehajWindows!) {
        const bh = isWithinBusinessHours(w.start, w.end, VENUE_TZ);
        if (!bh.ok) {
          return NextResponse.json(
            { error: bh.error ?? 'Outside business hours' },
            { status: 400 }
          );
        }
      }
    } else if (!isLongPath) {
      const bh = isWithinBusinessHours(start, end, VENUE_TZ);
      if (!bh.ok) {
        return NextResponse.json(
          { error: bh.error ?? 'Outside business hours' },
          { status: 400 }
        );
      }
    } else {
      if (!isBusinessStartHourTZ(start)) {
        return NextResponse.json(
          { error: 'Start time must be during business hours (7:00–19:00).' },
          { status: 400 }
        );
      }
    }

    // If someone tries to include KIRTAN in a multi-day booking, reject with guidance.
    // (Allow Sehaj Path + Kirtan via isSehajBooking exception.)
    if (isLong && !isPurePath && !isSehajBooking) {
      return NextResponse.json(
        {
          error:
            'Kirtan cannot be scheduled inside a multi-day window. Create a 48h Akhand Path booking, then a separate short Kirtan (“Samapti”) at the end.',
        },
        { status: 400 }
      );
    }

    // ——— Trailing-Kirtan whole-jatha server guard ———
    const trailingMax = Math.max(
      ...programs.map((p) => p.trailingKirtanMinutes ?? 0)
    );

    const needsTrailingJatha = trailingMax > 0 && ENFORCE_WHOLE_JATHA;

    if (needsTrailingJatha) {
      const tStart = new Date(end.getTime() - trailingMax * 60_000);

      // Build busy-by-hour using assignment windows; respect outside buffer
      const busyByHour: Record<number, Set<string>> = {};
      for (const h of BUSINESS_HOURS_24) busyByHour[h] = new Set();

      const asns = await prisma.bookingAssignment.findMany({
        where: {
          booking: {
            start: { lt: end },
            end: { gt: tStart },
            status: { in: ['PENDING', 'CONFIRMED'] },
          },
        },
        select: {
          staffId: true,
          start: true,
          end: true,
          booking: { select: { start: true, end: true, locationType: true } },
        },
      });

      for (const a of asns) {
        const sRaw = a.start ?? a.booking.start;
        const eRaw = a.end ?? a.booking.end;
        const s = new Date(sRaw);
        const e = new Date(eRaw);
        const paddedStart =
          a.booking.locationType === 'OUTSIDE_GURDWARA'
            ? new Date(s.getTime() - OUTSIDE_BUFFER_MS)
            : s;
        const paddedEnd =
          a.booking.locationType === 'OUTSIDE_GURDWARA'
            ? new Date(e.getTime() + OUTSIDE_BUFFER_MS)
            : e;
        const hrs = hourSpan(paddedStart, paddedEnd).filter((h) =>
          BUSINESS_HOURS_24.includes(h)
        );
        for (const h of hrs) busyByHour[h].add(a.staffId);
      }

      const jathaGroups = await getJathaGroups();
      const trailingHours = hourSpan(tStart, end).filter((h) =>
        BUSINESS_HOURS_24.includes(h)
      );

      function countWholeFreeJathasAtHour(busySet: Set<string>) {
        let free = 0;
        for (const [_k, members] of jathaGroups) {
          const ids = members.map((m) => m.id);
          if (ids.length >= JATHA_SIZE && ids.every((id) => !busySet.has(id))) {
            free += 1;
          }
        }
        return free;
      }

      for (const hh of trailingHours) {
        const freeJ = countWholeFreeJathasAtHour(busyByHour[hh]);
        if (freeJ < 1) {
          return NextResponse.json(
            {
              error:
                'No full jatha is free during the trailing Kirtan window. Pick a different time/date.',
            },
            { status: 409 }
          );
        }
      }
    }

    // ————— Pick a hall if at the Gurdwara —————
    let hallId: string | null = null;
    if (input.locationType === 'GURDWARA') {
      const attendees =
        typeof input.attendees === 'number' ? Math.max(1, input.attendees) : 1;

      // ✅ For Sehaj, hall check should use windows (start/end) not the full multi-day
      const hallWindows = sehajWindows;
      hallId = await pickFirstFittingHall(start, end, attendees, hallWindows);

      if (!hallId) {
        return NextResponse.json(
          {
            error:
              'No suitable hall is free at that time for the attendee count.',
          },
          { status: 409 }
        );
      }

      console.log('[hall-pick]', {
        start: start.toISOString(),
        end: end.toISOString(),
        attendees,
        hallId,
        hallWindows: hallWindows?.map((w) => ({
          start: w.start.toISOString(),
          end: w.end.toISOString(),
        })),
      });
    }

    // ✅ Capacity windows:
    // - Sehaj-only: check staffing only for start + end windows (not the whole multi-day span)
    // - Normal: check the whole window
    const effectiveWindows: TimeWindow[] = isSehajBooking
      ? (sehajWindows as TimeWindow[])
      : [{ start, end }];

    // Apply outside travel buffer per window (used for staff capacity)
    const candidateWindows = effectiveWindows.map((w) =>
      padWindow(w, input.locationType as any, OUTSIDE_BUFFER_MS)
    );

    const hoursByWindow = candidateWindows.map((w) =>
      hourSpan(w.start, w.end).filter((h) => BUSINESS_HOURS_24.includes(h))
    );

    if (hoursByWindow.some((hrs) => !hrs.length)) {
      return NextResponse.json(
        { error: 'Selected time is outside business hours.' },
        { status: 400 }
      );
    }

    // ————— Transaction: capacity compute + create —————
    const created: CreatedBooking = await prisma.$transaction(async (tx) => {
      // ✅ Capacity check
      // For Sehaj, we evaluate overlaps PER window (start/end) so bookings "in between"
      // do NOT incorrectly count against Sehaj staffing.
      if (!isLongPath) {
        const totalUniqueStaff = await getTotalUniqueStaffCount(); // unique humans
        const totalPool = await getTotalPoolPerRole(); // total active staff by role
        const locMax = getMaxPerLocationPerRole(input.locationType);

        for (let wi = 0; wi < candidateWindows.length; wi++) {
          const win = candidateWindows[wi];
          const hours = hoursByWindow[wi] ?? [];
          if (!hours.length) continue;

          const overlapBookings = await tx.booking.findMany({
            where: {
              start: { lt: win.end },
              end: { gt: win.start },
              status: { in: ['PENDING', 'CONFIRMED'] },
            },
            include: {
              items: {
                include: {
                  programType: {
                    select: {
                      name: true,
                      minPathers: true,
                      minKirtanis: true,
                      peopleRequired: true,
                      durationMinutes: true,
                      category: true,
                    },
                  },
                },
              },
            },
          });

          const usedGW: Record<number, RoleVector> = {};
          const usedOUT: Record<number, RoleVector> = {};
          const usedHeadGW: Record<number, number> = {};
          const usedHeadOUT: Record<number, number> = {};
          for (const h of BUSINESS_HOURS_24) {
            usedGW[h] = { PATH: 0, KIRTAN: 0 };
            usedOUT[h] = { PATH: 0, KIRTAN: 0 };
            usedHeadGW[h] = 0;
            usedHeadOUT[h] = 0;
          }

          for (const b of overlapBookings) {
            const vec = b.items.reduce(
              (acc, it: any) => add(acc, reqFromProgram(it.programType as any)),
              { PATH: 0, KIRTAN: 0 }
            );

            const headForBooking = b.items
              .map((it: any) => {
                const pt: any = it.programType;
                const minSum = (pt.minPathers ?? 0) + (pt.minKirtanis ?? 0);

                // ✅ IMPORTANT: Exclude Sehaj from Akhand long-path headcount shortcut.
                const isLongPathItem =
                  pt.category === ProgramCategory.PATH &&
                  !isSehajName(pt.name) &&
                  (pt.durationMinutes ?? 0) >= 36 * 60 &&
                  (pt.minKirtanis ?? 0) === 0;

                if (isLongPathItem) {
                  return Math.max(minSum, 1);
                }

                return Math.max(pt.peopleRequired ?? 0, minSum);
              })
              .reduce((a: number, bb: number) => a + bb, 0);

            const s = new Date(b.start);
            const e = new Date(b.end);

            // ✅ If the existing booking is Sehaj-only, it only consumes hours at its windows
            const bWindows = hallWindowsForPrograms(
              (b.items ?? []).map((it: any) => ({
                name: it.programType?.name,
              })),
              s,
              e
            ) ?? [{ start: s, end: e }];

            for (const bw of bWindows) {
              const paddedBw = padWindow(
                bw,
                b.locationType as any,
                OUTSIDE_BUFFER_MS
              );
              const inter = intersectWindow(paddedBw, win);
              if (!inter) continue;

              const hrs = hourSpan(inter.start, inter.end).filter((h) =>
                BUSINESS_HOURS_24.includes(h)
              );

              for (const h of hrs) {
                if (b.locationType === 'GURDWARA') {
                  usedGW[h].PATH += vec.PATH ?? 0;
                  usedGW[h].KIRTAN += vec.KIRTAN ?? 0;
                  usedHeadGW[h] += headForBooking;
                } else {
                  usedOUT[h].PATH += vec.PATH ?? 0;
                  usedOUT[h].KIRTAN += vec.KIRTAN ?? 0;
                  usedHeadOUT[h] += headForBooking;
                }
              }
            }
          }

          // Ensure capacity exists each hour in this window
          for (const h of hours) {
            for (const r of ROLES as ReadonlyArray<keyof RoleVector>) {
              const total = totalPool[r] ?? 0;
              const usedOpp =
                input.locationType === 'GURDWARA'
                  ? (usedOUT[h][r] ?? 0)
                  : (usedGW[h][r] ?? 0);
              const usedHere =
                input.locationType === 'GURDWARA'
                  ? (usedGW[h][r] ?? 0)
                  : (usedOUT[h][r] ?? 0);

              // Shared pool vs per-location cap
              const sharedLimit = Math.max(0, total - usedOpp);
              const locLimit = Math.min(
                sharedLimit,
                (locMax as any)[r] ?? Number.MAX_SAFE_INTEGER
              );

              const remaining = Math.max(0, locLimit - usedHere);
              const need = (required[r] ?? 0) as number;
              if (remaining < need) throw new Error('CAPACITY_EXCEEDED');
            }

            // Headcount guard
            const usedOppHead =
              input.locationType === 'GURDWARA'
                ? usedHeadOUT[h]
                : usedHeadGW[h];
            const usedHereHead =
              input.locationType === 'GURDWARA'
                ? usedHeadGW[h]
                : usedHeadOUT[h];
            const remainingHead = Math.max(
              0,
              totalUniqueStaff - usedOppHead - usedHereHead
            );
            if (remainingHead < headcountRequired)
              throw new Error('CAPACITY_EXCEEDED');
          }
        }
      }
      // Long path: skip staff pool/headcount checks; we just hold the slot/hall.

      // after you resolve `session`, before tx.booking.create(...)
      let createdByData: Record<string, any> = {};
      try {
        const sid = (session as any)?.user?.id as string | undefined;
        const semail = (session as any)?.user?.email as string | undefined;

        if (sid) {
          const exists = await prisma.user.findUnique({
            where: { id: sid },
            select: { id: true },
          });
          if (exists) {
            createdByData = { createdBy: { connect: { id: exists.id } } };
          }
        } else if (semail) {
          createdByData = {
            createdBy: {
              connectOrCreate: {
                where: { email: semail.toLowerCase() },
                create: {
                  email: semail.toLowerCase(),
                  role: 'VIEWER' as const,
                },
              },
            },
          };
        }
      } catch {
        // leave createdByData = {}
      }

      const createdRaw = await tx.booking.create({
        data: {
          title: input.title,
          start,
          end,
          locationType: input.locationType,
          ...(hallId ? { hall: { connect: { id: hallId } } } : {}),
          address:
            input.locationType === 'OUTSIDE_GURDWARA'
              ? (input.address ?? null)
              : null,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail ?? null,
          notes: input.notes ?? null,
          attendees:
            typeof input.attendees === 'number'
              ? Math.max(1, input.attendees)
              : 1,
          status: 'PENDING',
          ...createdByData,
          items: {
            create: input.items.map((i: any) => ({
              programTypeId: i.programTypeId,
            })),
          },
        },
        include: {
          hall: { select: { name: true } },
          items: {
            include: {
              programType: {
                select: {
                  name: true,
                  category: true,
                  durationMinutes: true,
                },
              },
            },
          },
        },
      });

      const normalized: CreatedBooking = {
        id: createdRaw.id,
        title: createdRaw.title,
        start: createdRaw.start,
        end: createdRaw.end,
        locationType: createdRaw.locationType as CreatedBooking['locationType'],
        hallId: createdRaw.hallId,
        address: createdRaw.address,
        contactName: createdRaw.contactName,
        contactPhone: createdRaw.contactPhone,
        contactEmail: createdRaw.contactEmail,
        notes: createdRaw.notes,
        attendees: createdRaw.attendees,
        hall: createdRaw.hall ? { name: createdRaw.hall.name } : null,
        items: createdRaw.items.map((it) => ({
          id: it.id,
          programType: {
            name: it.programType.name,
            category: it.programType.category,
            durationMinutes: it.programType.durationMinutes,
          },
        })),
      };
      return normalized;
    });

    // Auto-assign: optional.
    if (process.env.AUTO_ASSIGN_ENABLED === '1') {
      try {
        const durationHrs =
          (created.end.getTime() - created.start.getTime()) / 3_600_000;

        // ✅ Skip only for Akhand-style long path, but NOT Sehaj
        const skipAssign =
          durationHrs >= 36 && required.KIRTAN === 0 && !isSehajBooking;

        if (!skipAssign) {
          const res = await autoAssignForBooking(created.id);
          if (
            res?.created?.length &&
            process.env.ASSIGN_NOTIFICATIONS === '1'
          ) {
            await notifyAssignmentsStaff(
              created.id,
              res.created.map((a) => ({
                staffId: a.staffId,
                bookingItemId: a.bookingItemId,
              }))
            );
          }
        }
      } catch (e) {
        console.error('Auto-assign or notify failed', e);
      }
    }

    // notifications
    const { date: startDate, time: startTime } = toLocalParts(created.start);
    const { time: endTime } = toLocalParts(created.end);

    // Build a manage URL for admins, if NEXTAUTH_URL is set
    const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/+$/, '') ?? '';
    const manageUrl = baseUrl
      ? `${baseUrl}/admin/bookings/${created.id}`
      : null;

    const emailPrograms = created.items.map((it) => ({
      name: it.programType.name,
      category: it.programType.category,
      durationMinutes: it.programType.durationMinutes,
    }));

    const adminHtml = renderBookingEmailAdmin({
      bookingId: created.id,
      title: created.title,
      date: startDate,
      startLocal: startTime,
      endLocal: endTime,
      locationType: created.locationType,
      hallName: created.hall?.name ?? null,
      address: created.address,
      attendees: created.attendees,
      requesterName: created.contactName,
      requesterEmail: created.contactEmail,
      requesterPhone: created.contactPhone,
      notes: created.notes,
      sourceLabel: 'Public booking form',
      manageUrl,
      programs: emailPrograms,
    });

    const customerHtml = renderBookingEmailCustomer({
      bookingId: created.id,
      title: created.title,
      date: startDate,
      startLocal: startTime,
      endLocal: endTime,
      locationType: created.locationType,
      hallName: created.hall?.name ?? null,
      address: created.address,
      attendees: created.attendees,
      programs: emailPrograms,
    });

    const smsText = renderBookingText({
      bookingId: created.id,
      title: created.title,
      date: startDate,
      startLocal: startTime,
      endLocal: endTime,
      locationType: created.locationType,
      hallName: created.hall?.name ?? null,
      address: created.address,
      programs: emailPrograms,
    });

    const adminRecipients = getAdminEmails();
    const customerEmail = created.contactEmail;

    if (shouldSendBookingNotifications) {
      await Promise.allSettled([
        adminRecipients.length
          ? sendEmail({
              to: adminRecipients,
              subject: 'New Path/Kirtan booking (Pending approval)',
              html: adminHtml,
            })
          : Promise.resolve(),
        customerEmail
          ? sendEmail({
              to: customerEmail,
              subject: 'Thank you — your booking request was received',
              html: customerHtml,
            })
          : Promise.resolve(),
        created.contactPhone
          ? sendSms({ toE164: created.contactPhone, text: smsText })
          : Promise.resolve(),
      ]);
    } else {
      console.log('[bookings] Skipping booking email/SMS', {
        VERCEL_ENV,
        NODE_ENV,
        bookingNotificationsEnabled,
      });
    }

    return NextResponse.json(
      { id: created.id, status: 'PENDING' },
      { status: 201 }
    );
  } catch (e: any) {
    if (String(e?.message) === 'CAPACITY_EXCEEDED') {
      return NextResponse.json(
        {
          error:
            'Not enough sevadars available for the selected time (role minimums or total headcount).',
        },
        { status: 409 }
      );
    }
    console.error('Booking create error', e);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  const isAdmin = role === 'ADMIN';

  const url = new URL(req.url);
  const status = url.searchParams.get('status'); // e.g. PENDING | CONFIRMED
  const from = url.searchParams.get('from'); // ISO date
  const to = url.searchParams.get('to'); // ISO date

  const where: any = {};
  if (status) where.status = status;
  if (!isAdmin && !status) where.status = 'CONFIRMED';

  if (from || to) {
    where.start = {};
    if (from) where.start.gte = new Date(from);
    if (to) where.start.lte = new Date(to);
  }

  const data = await prisma.booking.findMany({
    where,
    orderBy: { start: 'desc' },
    take: isAdmin ? 100 : 50,
    include: {
      hall: true,
      items: { include: { programType: true } },
      assignments: {
        include: {
          staff: true,
          bookingItem: { include: { programType: true } },
        },
      },
    },
  });

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
