import { PrismaClient, ProgramCategory } from '@prisma/client';
const prisma = new PrismaClient();

async function upsertProgram(
  name: string,
  category: ProgramCategory,
  requiresRagi: number,
  requiresGranthi: number,
  canBeAtHome: boolean,
  defaultMinutes = 120
) {
  await prisma.programType.upsert({
    where: { name },
    update: {
      category: { set: category },
      requiresRagi,
      requiresGranthi,
      canBeAtHome,
      defaultMinutes,
      isActive: true,
    },
    create: {
      name,
      category,
      requiresRagi,
      requiresGranthi,
      canBeAtHome,
      defaultMinutes,
    },
  });
}

async function main() {
  await prisma.hall.createMany({
    data: [{ name: 'Main Hall' }, { name: 'Hall 2' }],
    skipDuplicates: true,
  });

  await upsertProgram('Kirtan', ProgramCategory.KIRTAN, 1, 0, true, 120);
  await upsertProgram('Path', ProgramCategory.PATH, 0, 1, true, 120);
  await upsertProgram('Sukhmani Sahib', ProgramCategory.PATH, 0, 1, true, 180);
  await upsertProgram('Akhand Path', ProgramCategory.PATH, 0, 1, true, 4320);
}

main().finally(() => prisma.$disconnect());
