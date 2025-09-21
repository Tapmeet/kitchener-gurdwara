// app/api/assignments/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const bookingId = searchParams.get('bookingId') ?? '';
    if (!bookingId) {
      return NextResponse.json(
        { error: 'bookingId is required' },
        { status: 400 }
      );
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        title: true,
        start: true,
        end: true,
        locationType: true,
        hallId: true,
        items: {
          select: {
            id: true,
            notes: true,
            programType: {
              select: {
                id: true,
                name: true,
                category: true,
                minPathers: true,
                minKirtanis: true,
                durationMinutes: true,
              },
            },
            assignments: {
              select: {
                id: true,
                staff: {
                  select: {
                    id: true,
                    name: true,
                    skills: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Compute assigned counts per skill per item
    const items = booking.items.map((it) => {
      const assigned = it.assignments.map((a) => a.staff);
      const assignedPath = assigned.filter((s) =>
        s.skills.includes('PATH')
      ).length;
      const assignedKirtan = assigned.filter((s) =>
        s.skills.includes('KIRTAN')
      ).length;

      return {
        itemId: it.id,
        program: {
          id: it.programType.id,
          name: it.programType.name,
          category: it.programType.category,
          minPathers: it.programType.minPathers,
          minKirtanis: it.programType.minKirtanis,
          durationMinutes: it.programType.durationMinutes,
        },
        assigned: it.assignments.map((a) => ({
          assignmentId: a.id,
          staff: a.staff,
        })),
        counts: {
          neededPath: it.programType.minPathers,
          neededKirtan: it.programType.minKirtanis,
          assignedPath,
          assignedKirtan,
        },
        notes: it.notes ?? null,
      };
    });

    return NextResponse.json({
      booking: {
        id: booking.id,
        title: booking.title,
        start: booking.start,
        end: booking.end,
        locationType: booking.locationType,
        hallId: booking.hallId,
      },
      items,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Unexpected error' },
      { status: 500 }
    );
  }
}
