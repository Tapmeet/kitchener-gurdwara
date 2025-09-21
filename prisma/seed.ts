import { PrismaClient, ProgramCategory } from '@prisma/client';
const prisma = new PrismaClient();

async function upsertProgram(
  name: string,
  category: ProgramCategory,
  requiresRagi: number,
  requiresGranthi: number,
  defaultMinutes = 120
) {
  // All can be at home; none require a hall.
  const canBeAtHome = true;
  const requiresHall = false;

  await prisma.programType.upsert({
    where: { name },
    update: {
      category,
      requiresRagi,
      requiresGranthi,
      canBeAtHome,
      requiresHall,
      defaultMinutes,
      isActive: true,
    },
    create: {
      name,
      category,
      requiresRagi,
      requiresGranthi,
      canBeAtHome,
      requiresHall,
      defaultMinutes,
    },
  });
}

async function main() {
  await prisma.hall.createMany({
    data: [{ name: 'Main Hall' }, { name: 'Hall 2' }],
    skipDuplicates: true,
  });

  await upsertProgram('Kirtan', ProgramCategory.KIRTAN, 1, 0, 120);
  await upsertProgram('Path', ProgramCategory.PATH, 0, 1, 120);
  await upsertProgram('Sukhmani Sahib', ProgramCategory.PATH, 0, 1, 180);
  await upsertProgram('Akhand Path', ProgramCategory.PATH, 0, 1, 4320);
}

main().finally(() => prisma.$disconnect());
