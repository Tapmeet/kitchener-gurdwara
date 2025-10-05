// src/app/api/assignments/swap/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

function isPriv(role?: string | null) {
  return role === "ADMIN" || role === "SECRETARY";
}

// POST body: { a: string, b: string }
// where a and b are BookingAssignment IDs. Swaps staff between them.
export async function POST(req: Request) {
  const session = await auth();
  const role = (session?.user as any)?.role ?? null;
  if (!session?.user || !isPriv(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as { a?: string; b?: string } | null;
  if (!body?.a || !body?.b || body.a === body.b) {
    return NextResponse.json({ error: "Provide two different assignment IDs: { a, b }" }, { status: 400 });
  }

  try {
    const [A, B] = await prisma.$transaction(async (tx) => {
      const A = await tx.bookingAssignment.findUnique({
        where: { id: body.a },
        include: { bookingItem: { include: { programType: true } } },
      });
      const B = await tx.bookingAssignment.findUnique({
        where: { id: body.b },
        include: { bookingItem: { include: { programType: true } } },
      });
      if (!A || !B) throw new Error("NOT_FOUND");

      // Ensure categories match (e.g., both KIRTAN)
      const catA = (A as any)?.bookingItem?.programType?.category;
      const catB = (B as any)?.bookingItem?.programType?.category;
      if (catA && catB && catA !== catB) throw new Error("CATEGORY_MISMATCH");

      await tx.bookingAssignment.update({ where: { id: A.id }, data: { staffId: B.staffId } });
      await tx.bookingAssignment.update({ where: { id: B.id }, data: { staffId: A.staffId } });
      return [A, B] as const;
    });

    return NextResponse.json({ ok: true, a: body.a, b: body.b });
  } catch (e: any) {
    const msg = e?.message ?? "";
    if (msg.includes("NOT_FOUND")) {
      return NextResponse.json({ error: "One or both assignments not found" }, { status: 404 });
    }
    if (msg.includes("CATEGORY_MISMATCH")) {
      return NextResponse.json({ error: "Assignments must have the same program category" }, { status: 400 });
    }
    return NextResponse.json({ error: "Swap failed" }, { status: 500 });
  }
}
