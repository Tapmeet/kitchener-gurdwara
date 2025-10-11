// prisma/seed.ts
import 'dotenv/config';
import bcrypt from 'bcrypt';
import {
  PrismaClient,
  ProgramCategory,
  StaffSkill,
  Jatha,
  UserRole,
} from '@prisma/client';

const prisma = new PrismaClient();

async function upsertHall(name: string, capacity: number | null) {
  await prisma.hall.upsert({
    where: { name },
    update: { capacity, isActive: true },
    create: { name, capacity, isActive: true },
  });
}

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
    compWeight?: number;
  }
) {
  const {
    durationMinutes,
    requiresHall = false,
    canBeOutsideGurdwara = true,
    compWeight = 1,
  } = opts;

  // normalize
  let minP = Math.max(0, opts.minPathers ?? 0);
  let minK = Math.max(0, opts.minKirtanis ?? 0);

  // hard rule: pure KIRTAN programs need 3 kirtanis and 0 pathers, people ≥ 3
  if (category === ProgramCategory.KIRTAN) {
    minP = 0;
    minK = Math.max(3, minK);
  }

  const minSum = minP + minK;
  const people = Math.max(opts.peopleRequired ?? 0, minSum);
  if ((opts.peopleRequired ?? 0) < minSum) {
    console.warn(
      `Adjusting peopleRequired for ${name}: ${opts.peopleRequired} -> ${people} (mins=${minSum})`
    );
  }

  await prisma.programType.upsert({
    where: { name },
    update: {
      category,
      durationMinutes,
      peopleRequired: people, // use normalized
      minPathers: minP, // use normalized
      minKirtanis: minK, // use normalized
      requiresHall,
      canBeOutsideGurdwara,
      isActive: true,
      compWeight,
    },
    create: {
      name,
      category,
      durationMinutes,
      peopleRequired: people, // use normalized
      minPathers: minP, // use normalized
      minKirtanis: minK, // use normalized
      requiresHall,
      canBeOutsideGurdwara,
      isActive: true,
      compWeight,
    },
  });
}

async function upsertStaff(
  name: string,
  skills: StaffSkill[],
  opts?: { jatha?: Jatha; email?: string; phone?: string }
) {
  await prisma.staff.upsert({
    where: { name },
    update: {
      skills,
      isActive: true,
      jatha: opts?.jatha ?? null,
      email: opts?.email ?? null,
      phone: opts?.phone ?? null,
    },
    create: {
      name,
      skills,
      isActive: true,
      jatha: opts?.jatha ?? null,
      email: opts?.email ?? null,
      phone: opts?.phone ?? null,
    },
  });
}

async function upsertUser(
  email: string,
  name: string,
  role: UserRole,
  passwordPlain: string
) {
  await prisma.user.upsert({
    where: { email },
    update: { name, role },
    create: {
      email,
      name,
      role,
      passwordHash: await bcrypt.hash(passwordPlain, 10),
    },
  });
}

async function main() {
  // Admin + Secretary => ADMIN (use enum, not string)
  await prisma.user.upsert({
    where: { email: 'admin@example.org' },
    update: { role: UserRole.ADMIN },
    create: {
      email: 'admin@example.org',
      name: 'Local Admin',
      role: UserRole.ADMIN,
      passwordHash: await bcrypt.hash('admin123', 10),
    },
  });

  await prisma.user.upsert({
    where: { email: 'secretary@example.org' },
    update: { role: UserRole.ADMIN },
    create: {
      email: 'secretary@example.org',
      name: 'Local Secretary',
      role: UserRole.ADMIN,
      passwordHash: await bcrypt.hash('secret123', 10),
    },
  });

  // Staff login accounts (Granthi + Sevadars) => STAFF
  await upsertUser(
    'granthi@example.com',
    'Granthi',
    UserRole.STAFF,
    'granthi123'
  );

  await upsertUser(
    'sevadar1@example.com',
    'Sevadar A1',
    UserRole.STAFF,
    'sevadar123'
  );
  await upsertUser(
    'sevadar2@example.com',
    'Sevadar A2',
    UserRole.STAFF,
    'sevadar123'
  );
  await upsertUser(
    'sevadar3@example.com',
    'Sevadar A3',
    UserRole.STAFF,
    'sevadar123'
  );

  await upsertUser(
    'sevadar4@example.com',
    'Sevadar B1',
    UserRole.STAFF,
    'sevadar123'
  );
  await upsertUser(
    'sevadar5@example.com',
    'Sevadar B2',
    UserRole.STAFF,
    'sevadar123'
  );
  await upsertUser(
    'sevadar6@example.com',
    'Sevadar B3',
    UserRole.STAFF,
    'sevadar123'
  );

  // Halls
  await upsertHall('Small Hall', 125);
  await upsertHall('Main Hall', 350);
  await upsertHall('Upper Hall', 100);

  // Staff (skills + optional jatha/emails)
  await upsertStaff('Granthi', [StaffSkill.PATH], {
    email: 'granthi@example.com',
    phone: '+11234567890',
  });
  await upsertStaff('Sevadar A1', [StaffSkill.KIRTAN, StaffSkill.PATH], {
    jatha: Jatha.A,
    email: 'sevadar1@example.com',
  });
  await upsertStaff('Sevadar A2', [StaffSkill.KIRTAN, StaffSkill.PATH], {
    jatha: Jatha.A,
    email: 'sevadar2@example.com',
  });
  await upsertStaff('Sevadar A3', [StaffSkill.KIRTAN, StaffSkill.PATH], {
    jatha: Jatha.A,
    email: 'sevadar3@example.com',
  });
  await upsertStaff('Sevadar B1', [StaffSkill.KIRTAN, StaffSkill.PATH], {
    jatha: Jatha.B,
    email: 'sevadar4@example.com',
  });
  await upsertStaff('Sevadar B2', [StaffSkill.KIRTAN, StaffSkill.PATH], {
    jatha: Jatha.B,
    email: 'sevadar5@example.com',
  });
  await upsertStaff('Sevadar B3', [StaffSkill.KIRTAN, StaffSkill.PATH], {
    jatha: Jatha.B,
    email: 'sevadar6@example.com',
  });

  // Programs
  await upsertProgram('Sukhmani Sahib Path + Kirtan', ProgramCategory.PATH, {
    durationMinutes: 120,
    peopleRequired: 3,
    minPathers: 0,
    minKirtanis: 3,
    compWeight: 3,
  });
  await upsertProgram('Sukhmani Sahib Path', ProgramCategory.PATH, {
    durationMinutes: 90,
    peopleRequired: 1,
    minPathers: 1,
    minKirtanis: 0,
    compWeight: 2,
  });
  await upsertProgram('Anand Karaj', ProgramCategory.OTHER, {
    durationMinutes: 180,
    peopleRequired: 4,
    minPathers: 1,
    minKirtanis: 3,
    requiresHall: true,
    canBeOutsideGurdwara: false,
    compWeight: 4,
  });
  await upsertProgram('Akhand Path + Kirtan', ProgramCategory.PATH, {
    durationMinutes: 49 * 60,
    peopleRequired: 4,
    minPathers: 1,
    minKirtanis: 3,
    compWeight: 6,
  });
  await upsertProgram('Antim Ardas', ProgramCategory.PATH, {
    durationMinutes: 120,
    peopleRequired: 3,
    minPathers: 3,
    minKirtanis: 0,
    compWeight: 3,
  });
  await upsertProgram('Alania Da Path + Kirtan', ProgramCategory.PATH, {
    durationMinutes: 120,
    peopleRequired: 3,
    minPathers: 0,
    minKirtanis: 3,
    compWeight: 3,
  });
  await upsertProgram('Assa Di War', ProgramCategory.KIRTAN, {
    durationMinutes: 180,
    peopleRequired: 3,
    minPathers: 3,
    minKirtanis: 0,
    compWeight: 4,
  });
  await upsertProgram('Kirtan', ProgramCategory.KIRTAN, {
    durationMinutes: 60,
    peopleRequired: 3,
    minPathers: 0,
    minKirtanis: 3,
    compWeight: 1,
  });
  await upsertProgram('Akhand Path', ProgramCategory.PATH, {
    durationMinutes: 48 * 60,
    peopleRequired: 4,
    minPathers: 4,
    minKirtanis: 0,
    compWeight: 5,
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
