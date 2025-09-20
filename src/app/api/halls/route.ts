import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
export async function GET() {
  const halls = await prisma.hall.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(halls);
}
