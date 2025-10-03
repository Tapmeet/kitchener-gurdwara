
// src/lib/report-fairness.ts
import { prisma } from "@/lib/db";
import { startOfWeek, endOfWeek, subWeeks, isAfter, isBefore } from "date-fns";
import type { ProgramCategory, StaffSkill } from "@prisma/client";

export type Role = "PATH" | "KIRTAN";
export type Jatha = "A" | "B";

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
  windowWeeks?: number;         // default 8
  role?: Role | "";             // filter to PATH or KIRTAN; empty for all
  jatha?: Jatha | "";           // filter by jatha
  q?: string;                   // name search (case-insensitive)
};

export async function buildFairnessReport(filters: ReportFilters = {}): Promise<{ rows: StaffFairnessRow[], windowStart: Date, windowEnd: Date }> {
  const windowWeeks = Number.isFinite(filters.windowWeeks) && (filters.windowWeeks as number) > 0 ? (filters.windowWeeks as number) : 8;
  const windowEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
  const windowStart = subWeeks(startOfWeek(windowEnd, { weekStartsOn: 1 }), windowWeeks);

  // Load active staff with optional filters
  const staff = await prisma.staff.findMany({
    where: {
      isActive: true,
      ...(filters.jatha ? { jatha: filters.jatha as Jatha } : {}),
      ...(filters.q ? { name: { contains: filters.q, mode: "insensitive" } } : {}),
    },
    select: { id: true, name: true, jatha: true, email: true, phone: true, skills: true },
    orderBy: [{ jatha: "asc" }, { name: "asc" }],
  });
  const staffIds = staff.map(s => s.id);
  if (!staffIds.length) return { rows: [], windowStart, windowEnd };

  // Pull assignments for those staff (all-time), including program info and booking start for time-window logic
  const asgn = await prisma.bookingAssignment.findMany({
    where: {
      staffId: { in: staffIds },
      ...(filters.role ? { bookingItem: { programType: { category: filters.role as ProgramCategory } } } : {}),
    },
    select: {
      staffId: true,
      booking: { select: { start: true } },
      bookingItem: { select: { programType: { select: { id: true, name: true, category: true, compWeight: true } } } },
    },
    orderBy: [{ booking: { start: "asc" } }],
  });

  // Pre-index staff
  const byStaff: Record<string, StaffFairnessRow> = {};
  for (const s of staff) {
    byStaff[s.id] = {
      staffId: s.id,
      name: s.name,
      jatha: (s.jatha as Jatha | null),
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

  for (const row of asgn) {
    const s = byStaff[row.staffId];
    if (!s) continue;

    const when = row.booking?.start ? new Date(row.booking.start) : null;
    const p = row.bookingItem.programType;
    const weight = p.compWeight ?? 1;

    if (when && (!s.lastAssignedAt || isAfter(when, s.lastAssignedAt))) {
      s.lastAssignedAt = when;
    }

    s.creditsTotal += weight;
    const inWindow = when ? (isAfter(when, windowStart) && isBefore(when, windowEnd)) : false;
    if (inWindow) s.creditsWindow += weight;

    if (!progMap[s.staffId]) progMap[s.staffId] = {};
    if (!progMap[s.staffId][p.id]) {
      progMap[s.staffId][p.id] = {
        programId: p.id,
        name: p.name,
        category: p.category,
        weight: weight,
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

  for (const s of staff) {
    const row = byStaff[s.id];
    const programs = progMap[s.id] ? Object.values(progMap[s.id]) : [];
    // Sort programs by creditsWindow, then total
    programs.sort((a, b) => (b.creditsWindow - a.creditsWindow) || (b.creditsTotal - a.creditsTotal));
    row.programs = programs;
  }

  // Sort staff by creditsWindow desc (heaviest first) so the lightest appear at bottom for fairness
  const rows = Object.values(byStaff).sort((a, b) => (b.creditsWindow - a.creditsWindow) || (b.creditsTotal - a.creditsTotal));

  return { rows, windowStart, windowEnd };
}
