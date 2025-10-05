
// src/app/api/admin/reports/fairness/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildFairnessReport, type Role, type Jatha } from "@/lib/report-fairness";

function isAdminRole(role?: string | null) {
  return role === "ADMIN";
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || !isAdminRole((session.user as any).role)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const windowWeeks = Number(searchParams.get("windowWeeks") ?? 8);
  const role = (searchParams.get("role") ?? "") as Role | "";
  const jatha = (searchParams.get("jatha") ?? "") as Jatha | "";
  const q = searchParams.get("q") ?? "";

  const { rows, windowStart, windowEnd } = await buildFairnessReport({ windowWeeks, role, jatha, q });

  // Build CSV
  const header = ["Staff","Jatha","Skills","Email","Phone","WindowCredits","LifetimeCredits","TopPrograms(window/total)"];
  const lines = [header.join(",")];

  for (const r of rows) {
    const top = r.programs.slice(0, 5).map(p => `${p.name}(${p.creditsWindow}/${p.creditsTotal})`).join("; ");
    const line = [
      `"${(r.name || "").replace(/"/g, '""')}"`,
      r.jatha ? `"${r.jatha}"` : '""',
      `"${r.skills.join(" ").replace(/"/g, '""')}"`,
      r.email ? `"${r.email.replace(/"/g, '""')}"` : '""',
      r.phone ? `"${r.phone.replace(/"/g, '""')}"` : '""',
      String(r.creditsWindow),
      String(r.creditsTotal),
      `"${top.replace(/"/g, '""')}"`,
    ].join(",");
    lines.push(line);
  }

  const csv = lines.join("\r\n");
  const filename = `fairness_${windowWeeks}w.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
