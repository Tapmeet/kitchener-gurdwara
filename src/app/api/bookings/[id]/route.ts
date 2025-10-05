import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { prisma } from '@/lib/db';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  // ⬅️ params must be awaited on Next.js 15+
  const { id } = await ctx.params;

  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  const isAdmin = role === "ADMIN";
  if (!isAdmin)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      hall: { select: { id: true, name: true } },
      items: {
        include: {
          programType: { select: { id: true, name: true, category: true } },
        },
      },
      assignments: {
        include: {
          staff: { select: { id: true, name: true, skills: true } },
          bookingItem: {
            include: {
              programType: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' }, // valid on BookingAssignment
      },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!booking)
    return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const payload = {
    id: booking.id,
    title: booking.title,
    start: booking.start,
    end: booking.end,
    locationType: booking.locationType,
    hall: booking.hall
      ? { id: booking.hall.id, name: booking.hall.name }
      : null,
    address: booking.address ?? null,
    attendees: booking.attendees,
    contactName: booking.contactName,
    contactPhone: booking.contactPhone,
    contactEmail: booking.contactEmail ?? null,
    notes: booking.notes ?? null,
    programs: booking.items
      .map((i) =>
        i.programType
          ? {
              id: i.programType.id,
              name: i.programType.name,
              category: i.programType.category,
            }
          : null
      )
      .filter(Boolean) as {
      id: string;
      name: string;
      category?: string | null;
    }[],
    assignments: booking.assignments.map((a) => ({
      id: a.id,
      staff: a.staff
        ? { id: a.staff.id, name: a.staff.name, skills: a.staff.skills }
        : null,
      programType: a.bookingItem?.programType
        ? {
            id: a.bookingItem.programType.id,
            name: a.bookingItem.programType.name,
          }
        : null,
    })),
    createdBy: booking.createdBy ?? null,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };

  return NextResponse.json(payload);
}
