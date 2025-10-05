import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
export async function GET() {
  const pts = await prisma.programType.findMany({
    where: { isActive: true },
    orderBy: { name: 'desc' },
  });
  return NextResponse.json(pts);
}
