// src/lib/report-fairness.ts
import { prisma } from '@/lib/db';
import { startOfWeek, endOfWeek, subWeeks, isWithinInterval } from 'date-fns';
import {
  AssignmentState,
  BookingStatus,
  ProgramCategory,
  StaffSkill,
} from '@/generated/prisma/client';

export type Role = 'PATH' | 'KIRTAN';
export type Jatha = 'A' | 'B';

export type ProgramBreakdown = {
  programId: string;
  name: string;
  category: ProgramCategory;
  weight: number;
  countTotal: number;
  creditsTotal: number;
  countWindow: number;
  creditsWindow: number;
};

export type StaffFairnessRow = {
  staffId: string;
  name: string;
  jatha: Jatha | null;
  email: string | null;
  phone: string | null;
  skills: StaffSkill[];
  lastAssignedAt: Date | null;
  creditsTotal: number;
  creditsWindow: number;
  programs: ProgramBreakdown[];
};

export type ReportFilters = {
  windowWeeks?: number; // default 8
  role?: Role | ''; // PATH or KIRTAN; empty = all
  jatha?: Jatha | ''; // filter by jatha
  q?: string; // name search (case-insensitive)
};

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
];

export async function buildFairnessReport(
  filters: ReportFilters = {}
): Promise<{ rows: StaffFairnessRow[]; windowStart: Date; windowEnd: Date }> {
  // --- 1) Window calculation ----------------------------------------------
  const wwRaw = filters.windowWeeks;
  const windowWeeks =
    typeof wwRaw === 'number' && Number.isFinite(wwRaw) && wwRaw > 0
      ? wwRaw
      : 8;

  const today = new Date();
  const windowEnd = endOfWeek(today, { weekStartsOn: 1 }); // Sun (Mon-start week)
  const windowStart = subWeeks(
    startOfWeek(windowEnd, { weekStartsOn: 1 }),
    windowWeeks - 1
  );

  // --- 2) Load active staff with filters ----------------------------------
  const staff = await prisma.staff.findMany({
    where: {
      isActive: true,
      ...(filters.jatha ? { jatha: filters.jatha as Jatha } : {}),
      ...(filters.q
        ? { name: { contains: filters.q, mode: 'insensitive' } }
        : {}),
    },
    select: {
      id: true,
      name: true,
      jatha: true,
      email: true,
      phone: true,
      skills: true,
    },
    orderBy: [{ jatha: 'asc' }, { name: 'asc' }],
  });

  const staffIds = staff.map((s) => s.id);
  if (!staffIds.length) return { rows: [], windowStart, windowEnd };

  // --- 3) Pull assignments (confirmed + active bookings only) -------------
  const asgn = await prisma.bookingAssignment.findMany({
    where: {
      staffId: { in: staffIds },

      // ✅ fairness credits should reflect real work only
      state: AssignmentState.CONFIRMED,

      // ✅ ignore cancelled/expired bookings in fairness report
      booking: { status: { in: ACTIVE_BOOKING_STATUSES } },

      ...(filters.role
        ? {
            bookingItem: {
              programType: {
                category: filters.role as ProgramCategory,
              },
            },
          }
        : {}),
    },
    select: {
      staffId: true,
      start: true,
      booking: { select: { start: true } },
      bookingItem: {
        select: {
          programType: {
            select: {
              id: true,
              name: true,
              category: true,
              compWeight: true,
            },
          },
        },
      },
    },

    orderBy: [{ booking: { start: 'asc' } }],
  });

  // --- 4) Pre-index staff rows --------------------------------------------
  const byStaff: Record<string, StaffFairnessRow> = {};
  for (const s of staff) {
    byStaff[s.id] = {
      staffId: s.id,
      name: s.name,
      jatha: s.jatha as Jatha | null,
      email: s.email ?? null,
      phone: s.phone ?? null,
      skills: s.skills as StaffSkill[],
      lastAssignedAt: null,
      creditsTotal: 0,
      creditsWindow: 0,
      programs: [],
    };
  }

  // Program stats keyed by staff -> programId
  const progMap: Record<string, Record<string, ProgramBreakdown>> = {};

  // --- 5) Aggregate credits & program breakdown ---------------------------
  for (const row of asgn) {
    const s = byStaff[row.staffId];
    if (!s) continue;

    const when = row.start
      ? new Date(row.start)
      : row.booking?.start
        ? new Date(row.booking.start)
        : null;
    const p = row.bookingItem.programType;
    const weight = p.compWeight ?? 1;

    if (when && (!s.lastAssignedAt || when > s.lastAssignedAt)) {
      s.lastAssignedAt = when;
    }

    // Lifetime credits
    s.creditsTotal += weight;

    // In-window?
    const inWindow =
      !!when &&
      isWithinInterval(when, {
        start: windowStart,
        end: windowEnd,
      });

    if (inWindow) {
      s.creditsWindow += weight;
    }

    if (!progMap[s.staffId]) progMap[s.staffId] = {};
    if (!progMap[s.staffId][p.id]) {
      progMap[s.staffId][p.id] = {
        programId: p.id,
        name: p.name,
        category: p.category,
        weight,
        countTotal: 0,
        creditsTotal: 0,
        countWindow: 0,
        creditsWindow: 0,
      };
    }
    const pb = progMap[s.staffId][p.id];

    pb.countTotal += 1;
    pb.creditsTotal += weight;

    if (inWindow) {
      pb.countWindow += 1;
      pb.creditsWindow += weight;
    }
  }

  // --- 6) Attach program breakdown, sorted by window credits --------------
  for (const s of staff) {
    const row = byStaff[s.id];
    const programs = progMap[s.id] ? Object.values(progMap[s.id]) : [];

    programs.sort(
      (a, b) =>
        b.creditsWindow - a.creditsWindow || b.creditsTotal - a.creditsTotal
    );

    row.programs = programs;
  }

  // --- 7) Sort staff: heaviest first by window credits (then lifetime) ----
  const rows = Object.values(byStaff).sort(
    (a, b) =>
      b.creditsWindow - a.creditsWindow || b.creditsTotal - a.creditsTotal
  );

  return { rows, windowStart, windowEnd };
}
