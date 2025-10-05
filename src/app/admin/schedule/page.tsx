
// src/app/admin/schedule/page.tsx
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { startOfWeek, endOfWeek, parseISO, isValid, format } from "date-fns";
import Link from "next/link";

type Role = "PATH" | "KIRTAN";
type Jatha = "A" | "B";

function fmt(d: Date) {
  try { return format(d, "EEE, MMM d yyyy, h:mm a"); } catch { return d.toString(); }
}

function isAdminRole(role?: string | null) {
  return role === "ADMIN";
}

function locLine(b: { locationType: "GURDWARA" | "OUTSIDE_GURDWARA"; hall?: { name: string } | null; address?: string | null; }) {
  if (b.locationType === "GURDWARA") return b.hall?.name ? `Gurdwara — ${b.hall.name}` : "Gurdwara";
  return b.address ? `Outside — ${b.address}` : "Outside";
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (!session?.user || !isAdminRole((session.user as any).role)) {
    return <div className="p-6">Unauthorized (admin/secretary only).</div>;
  }
  const params = await searchParams;

  const week = typeof params?.week === "string" ? parseISO(params.week) : new Date();
  const ws = isValid(week) ? startOfWeek(week, { weekStartsOn: 1 }) : startOfWeek(new Date(), { weekStartsOn: 1 });
  const we = endOfWeek(ws, { weekStartsOn: 1 });

  const role = (typeof params?.role === "string" ? params?.role : "") as Role | "";
  const jatha = (typeof params?.jatha === "string" ? params?.jatha : "") as Jatha | "";
  const q = (typeof params?.q === "string" ? params?.q : "").trim().toLowerCase();

  // Load active staff (optionally filter by jatha / name)
  const staff = await prisma.staff.findMany({
    where: {
      isActive: true,
      ...(jatha ? { jatha } : {}),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: [{ jatha: "asc" }, { name: "asc" }],
    select: { id: true, name: true, jatha: true, skills: true, email: true, phone: true },
  });

  const staffIds = staff.map(s => s.id);
  const assignments = staffIds.length ? await prisma.bookingAssignment.findMany({
    where: {
      staffId: { in: staffIds },
      booking: { start: { gte: ws }, end: { lte: we } },
      ...(role ? { bookingItem: { programType: { category: role } } } : {}),
    },
    include: {
      staff: { select: { id: true } },
      booking: { include: { hall: true } },
      bookingItem: { include: { programType: true } },
    },
    orderBy: [{ booking: { start: "asc" } }],
  }) : [];

  const byStaff = new Map<string, typeof assignments>();
  for (const s of staff) byStaff.set(s.id, [] as any);
  for (const a of assignments) byStaff.get(a.staff.id)!.push(a);

  const weekLabel = `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold">Staff Schedule (Week of {format(ws, "MMM d, yyyy")})</h1>
        <form className="flex items-center gap-2" action="/admin/schedule" method="get">
          <input type="date" name="week" className="border rounded px-2 py-1 text-sm" defaultValue={format(ws, "yyyy-MM-dd")} />
          <select name="jatha" className="border rounded px-2 py-1 text-sm" defaultValue={jatha}>
            <option value="">All Jathas</option>
            <option value="A">Jatha A</option>
            <option value="B">Jatha B</option>
          </select>
          <select name="role" className="border rounded px-2 py-1 text-sm" defaultValue={role}>
            <option value="">All Roles</option>
            <option value="KIRTAN">Kirtan</option>
            <option value="PATH">Path</option>
          </select>
          <input type="text" name="q" placeholder="Search name…" className="border rounded px-2 py-1 text-sm" defaultValue={q} />
          <button className="border rounded px-3 py-1 text-sm bg-gray-50 hover:bg-gray-100">Filter</button>
        </form>
      </div>

      <div className="text-sm text-gray-600">Showing: {weekLabel}{jatha ? ` · Jatha ${jatha}` : ""}{role ? ` · ${role}` : ""}{q ? ` · "${q}"` : ""}</div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {staff.map((s) => {
          const asgn = byStaff.get(s.id) ?? [];
          return (
            <div key={s.id} className="border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-medium">{s.name}{s.jatha ? ` · Jatha ${s.jatha}` : ""}</div>
                  <div className="text-xs text-gray-500">{s.skills.join(", ")}</div>
                </div>
                <a href={`/api/staff/${s.id}/assignments.ics`} className="text-xs underline hover:no-underline">ICS</a>
              </div>
              {asgn.length ? (
                <ul className="space-y-2">
                  {asgn.map((a) => {
                    const b = a.booking;
                    const it = a.bookingItem;
                    const role =
                      it.programType.category === "PATH" ? "Path"
                        : it.programType.category === "KIRTAN" ? "Kirtan"
                        : it.programType.category;
                    const loc = locLine(b as any);
                    return (
                      <li key={a.id} className="rounded border p-2">
                        <div className="text-sm font-medium">{b.title}</div>
                        <div className="text-xs text-gray-600">{fmt(b.start)} – {fmt(b.end)}</div>
                        <div className="text-xs">{loc}</div>
                        <div className="text-xs mt-0.5"><b>{role}</b> — {it.programType.name}</div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">No assignments this week.</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}