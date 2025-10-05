
// src/app/admin/reports/fairness/page.tsx
import { auth } from "@/lib/auth";
import { buildFairnessReport, type Role, type Jatha } from "@/lib/report-fairness";
import { format } from "date-fns";
import Link from "next/link";

function isAdminRole(role?: string | null) {
  return role === "ADMIN";
}

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const session = await auth();
  if (!session?.user || !isAdminRole((session.user as any).role)) {
    return <div className="p-6">Unauthorized (admin/secretary only).</div>;
  }

  const windowWeeks = Number(searchParams?.windowWeeks ?? 8);
  const role = (typeof searchParams?.role === "string" ? searchParams?.role : "") as Role | "";
  const jatha = (typeof searchParams?.jatha === "string" ? searchParams?.jatha : "") as Jatha | "";
  const q = (typeof searchParams?.q === "string" ? searchParams?.q.trim() : "") || "";

  const { rows, windowStart, windowEnd } = await buildFairnessReport({ windowWeeks, role, jatha, q });

  const csvHref = `/api/admin/reports/fairness?` +
    new URLSearchParams({ windowWeeks: String(windowWeeks), role, jatha, q }).toString();

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold">Fairness Report</h1>
        <form className="flex items-center gap-2" action="/admin/reports/fairness" method="get">
          <input type="number" name="windowWeeks" className="border rounded px-2 py-1 text-sm w-24" min={1} defaultValue={windowWeeks} />
          <select name="role" className="border rounded px-2 py-1 text-sm" defaultValue={role}>
            <option value="">All Roles</option>
            <option value="KIRTAN">Kirtan</option>
            <option value="PATH">Path</option>
          </select>
          <select name="jatha" className="border rounded px-2 py-1 text-sm" defaultValue={jatha}>
            <option value="">All Jathas</option>
            <option value="A">Jatha A</option>
            <option value="B">Jatha B</option>
          </select>
          <input type="text" name="q" placeholder="Search name…" className="border rounded px-2 py-1 text-sm" defaultValue={q} />
          <button className="border rounded px-3 py-1 text-sm bg-gray-50 hover:bg-gray-100">Filter</button>
        </form>
      </div>

      <div className="text-sm text-gray-600">
        Window: {format(windowStart, "MMM d, yyyy")} – {format(windowEnd, "MMM d, yyyy")}
        {role ? <> · {role}</> : null}
        {jatha ? <> · Jatha {jatha}</> : null}
        {q ? <> · "{q}"</> : null}
        <span className="ml-3">
          <a className="underline hover:no-underline" href={csvHref}>Export CSV</a>
        </span>
      </div>

      <div className="overflow-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left p-2">Staff</th>
              <th className="text-left p-2">Jatha</th>
              <th className="text-left p-2">Skills</th>
              <th className="text-right p-2">Window Credits</th>
              <th className="text-right p-2">Lifetime Credits</th>
              <th className="text-left p-2">Top Programs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.staffId} className="border-b align-top">
                <td className="p-2">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-gray-500">{r.email || r.phone || "—"}</div>
                </td>
                <td className="p-2">{r.jatha ? `Jatha ${r.jatha}` : "—"}</td>
                <td className="p-2">{r.skills.join(", ")}</td>
                <td className="p-2 text-right">{r.creditsWindow}</td>
                <td className="p-2 text-right">{r.creditsTotal}</td>
                <td className="p-2">
                  {r.programs.length ? (
                    <ul className="space-y-1">
                      {r.programs.slice(0, 4).map((p) => (
                        <li key={p.programId} className="text-xs">
                          <b>{p.name}</b> ({p.category}) · w:{p.weight} · {p.countWindow}/{p.countTotal} asg · cw:{p.creditsWindow}/ct:{p.creditsTotal}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs text-gray-500">No assignments</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? <div className="text-sm text-gray-500">No staff or no data for the selected filters.</div> : null}
    </div>
  );
}
