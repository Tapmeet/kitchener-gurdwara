import { PrismaClient, ProgramCategory, StaffSkill } from '@prisma/client';
const prisma = new PrismaClient();

/** Halls */
async function upsertHall(name: string, capacity: number | null) {
  await prisma.hall.upsert({
    where: { name }, // requires @unique on Hall.name
    update: { capacity },
    create: { name, capacity },
  });
}

/** Programs */
async function upsertProgram(
  name: string,
  category: ProgramCategory,
  opts: {
    durationMinutes: number;
    peopleRequired: number;
    minPathers: number;
    minKirtanis: number;
    requiresHall?: boolean;
    canBeOutsideGurdwara?: boolean;
  }
) {
  const {
    durationMinutes,
    peopleRequired,
    minPathers,
    minKirtanis,
    requiresHall = false,
    canBeOutsideGurdwara = true,
  } = opts;

  await prisma.programType.upsert({
    where: { name }, // requires @unique on ProgramType.name
    update: {
      category,
      durationMinutes,
      peopleRequired,
      minPathers,
      minKirtanis,
      requiresHall,
      canBeOutsideGurdwara,
      isActive: true,
    },
    create: {
      name,
      category,
      durationMinutes,
      peopleRequired,
      minPathers,
      minKirtanis,
      requiresHall,
      canBeOutsideGurdwara,
      isActive: true,
    },
  });
}

async function main() {
  // ----- Halls (with capacities) -----
  await upsertHall('Small Hall', 125);
  await upsertHall('Main Hall', 350);
  await upsertHall('Upper Hall', 100);

  // ----- Staff -----
  const staffData = [
    { name: 'Sevadar 1', skills: [StaffSkill.PATH, StaffSkill.KIRTAN] },
    { name: 'Sevadar 2', skills: [StaffSkill.PATH, StaffSkill.KIRTAN] },
    { name: 'Sevadar 3', skills: [StaffSkill.PATH, StaffSkill.KIRTAN] },
    { name: 'Sevadar 4', skills: [StaffSkill.PATH, StaffSkill.KIRTAN] },
    { name: 'Sevadar 5', skills: [StaffSkill.PATH, StaffSkill.KIRTAN] },
    { name: 'Sevadar 6', skills: [StaffSkill.PATH, StaffSkill.KIRTAN] },
    { name: 'Path-only Sevadar', skills: [StaffSkill.PATH] },
  ];
  for (const s of staffData) {
    await prisma.staff.upsert({
      where: { name: s.name },
      update: { skills: s.skills, isActive: true },
      create: { name: s.name, skills: s.skills, isActive: true },
    });
  }

  // ----- Program Types -----
  await upsertProgram('Sukhmani Sahib Path', ProgramCategory.PATH, {
    durationMinutes: 90,
    peopleRequired: 1,
    minPathers: 1,
    minKirtanis: 0,
  });

  await upsertProgram('Sukhmani Sahib Path With Kirtan', ProgramCategory.PATH, {
    durationMinutes: 120,
    peopleRequired: 3,
    minPathers: 1,
    minKirtanis: 1,
  });

  await upsertProgram('Akhand Path', ProgramCategory.PATH, {
    durationMinutes: 48 * 60,
    peopleRequired: 4,
    minPathers: 4,
    minKirtanis: 0,
  });

  await upsertProgram('Akhand Path with Kirtan', ProgramCategory.PATH, {
    durationMinutes: 49 * 60,
    peopleRequired: 4,
    minPathers: 4,
    minKirtanis: 1,
  });

  await upsertProgram('Assa Di War', ProgramCategory.KIRTAN, {
    durationMinutes: 180,
    peopleRequired: 4,
    minPathers: 0,
    minKirtanis: 3,
  });

  await upsertProgram('Anand Karaj', ProgramCategory.OTHER, {
    durationMinutes: 180,
    peopleRequired: 4,
    minPathers: 1,
    minKirtanis: 1,
  });

  await upsertProgram('Kirtan', ProgramCategory.KIRTAN, {
    durationMinutes: 60,
    peopleRequired: 3,
    minPathers: 0,
    minKirtanis: 3,
  });

  console.log('✅ Seed completed');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
