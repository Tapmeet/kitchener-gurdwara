// prisma/seed.ts
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaNeon } from '@prisma/adapter-neon';
import {
  PrismaClient,
  ProgramCategory,
  StaffSkill,
  Jatha,
  UserRole,
} from '@/generated/prisma/client';

// Use DIRECT_URL for seeding/migrations, fall back to DATABASE_URL if needed
const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DIRECT_URL or DATABASE_URL must be set for seeding');
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

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
    trailingKirtanMinutes?: number;
    pathRotationMinutes?: number;
    pathClosingDoubleMinutes?: number;
  }
) {
  const {
    durationMinutes,
    requiresHall = false,
    canBeOutsideGurdwara = true,
    compWeight = 1,
    trailingKirtanMinutes = 0,
    pathRotationMinutes = 0,
    pathClosingDoubleMinutes = 0,
  } = opts;

  // normalize mins vs people
  let minP = Math.max(0, opts.minPathers ?? 0);
  let minK = Math.max(0, opts.minKirtanis ?? 0);

  const isPureKirtan = category === ProgramCategory.KIRTAN;
  const isFullWindowKirtan = !isPureKirtan && minK > 0;

  // Pure KIRTAN: no Pathi, always at least 3 Kirtanis
  if (isPureKirtan) {
    minP = 0;
    minK = Math.max(3, minK);
  }

  // Mixed programs that explicitly specify Kirtanis (e.g. Anand Karaj)
  if (isFullWindowKirtan) {
    minK = Math.max(3, minK);
  }

  // NOTE: trailingKirtanMinutes alone does NOT force minKirtanis,
  // because Path and Kirtan don't overlap in those programs.

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
      peopleRequired: people,
      minPathers: minP,
      minKirtanis: minK,
      requiresHall,
      canBeOutsideGurdwara,
      isActive: true,
      compWeight,
      trailingKirtanMinutes,
      pathRotationMinutes,
      pathClosingDoubleMinutes,
    },
    create: {
      name,
      category,
      durationMinutes,
      peopleRequired: people,
      minPathers: minP,
      minKirtanis: minK,
      requiresHall,
      canBeOutsideGurdwara,
      isActive: true,
      compWeight,
      trailingKirtanMinutes,
      pathRotationMinutes,
      pathClosingDoubleMinutes,
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
  // Admins
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

  // Staff login accounts
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

  // Staff (skills + jatha/emails)
  await upsertStaff('Granthi', [StaffSkill.PATH], {
    email: 'granthi@example.com',
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

  // Sukhmani Sahib Path + Kirtan (2.5h; Path 1.5h → Kirtan 1h)
  await upsertProgram('Sukhmani Sahib Path + Kirtan', ProgramCategory.PATH, {
    durationMinutes: 120,
    peopleRequired: 3, // max concurrent heads during Kirtan window
    minPathers: 1,
    minKirtanis: 0, // trailingKirtan drives the jatha
    trailingKirtanMinutes: 60,
    pathRotationMinutes: 0,
    pathClosingDoubleMinutes: 0,
    requiresHall: false,
    canBeOutsideGurdwara: true,
    compWeight: 3,
  });

  // Sukhmani Sahib Path (1.5h Path only)
  await upsertProgram('Sukhmani Sahib Path', ProgramCategory.PATH, {
    durationMinutes: 90,
    peopleRequired: 1,
    minPathers: 1,
    minKirtanis: 0,
    trailingKirtanMinutes: 0,
    pathRotationMinutes: 0,
    pathClosingDoubleMinutes: 0,
    requiresHall: false,
    canBeOutsideGurdwara: true,
    compWeight: 2,
  });

  // Anand Karaj (Path + Kirtan concurrent full window, e.g., 3h)
  await upsertProgram('Anand Karaj', ProgramCategory.OTHER, {
    durationMinutes: 180,
    peopleRequired: 4, // 3 Kirtan + 1 Path concurrently
    minPathers: 1,
    minKirtanis: 3, // full-window Kirtan
    trailingKirtanMinutes: 0,
    pathRotationMinutes: 0,
    pathClosingDoubleMinutes: 0,
    requiresHall: false,
    canBeOutsideGurdwara: false,
    compWeight: 4,
  });

  // Antim Ardas (Alania Da Path) + Kirtan
  await upsertProgram(
    'Antim Ardas (Alania Da Path) + Kirtan',
    ProgramCategory.PATH,
    {
      durationMinutes: 120,
      peopleRequired: 3, // max concurrent heads
      minPathers: 1,
      minKirtanis: 0,
      trailingKirtanMinutes: 60,
      pathRotationMinutes: 0,
      pathClosingDoubleMinutes: 0,
      requiresHall: false,
      canBeOutsideGurdwara: true,
      compWeight: 3,
    }
  );

  // Assa Di War (3h Kirtan only)
  await upsertProgram('Assa Di War', ProgramCategory.KIRTAN, {
    durationMinutes: 180,
    peopleRequired: 3,
    minPathers: 0,
    minKirtanis: 3,
    trailingKirtanMinutes: 0,
    pathRotationMinutes: 0,
    pathClosingDoubleMinutes: 0,
    requiresHall: false,
    canBeOutsideGurdwara: true,
    compWeight: 4,
  });

  // Kirtan (1h Kirtan only)
  await upsertProgram('Kirtan', ProgramCategory.KIRTAN, {
    durationMinutes: 60,
    peopleRequired: 3,
    minPathers: 0,
    minKirtanis: 3,
    trailingKirtanMinutes: 0,
    pathRotationMinutes: 0,
    pathClosingDoubleMinutes: 0,
    requiresHall: false,
    canBeOutsideGurdwara: true,
    compWeight: 1,
  });

  /* Akhand variants – hourly windows are produced by code (not peopleRequired) */

  // Akhand Path + Kirtan (48h Path rotations + closing double; last 1h Kirtan)
  await upsertProgram('Akhand Path + Kirtan', ProgramCategory.PATH, {
    durationMinutes: 49 * 60, // 48h path + 1h kirtan tail
    peopleRequired: 3, // max concurrent heads at any moment
    minPathers: 1,
    minKirtanis: 0,
    trailingKirtanMinutes: 60,
    pathRotationMinutes: 120, // 2h rotations
    pathClosingDoubleMinutes: 60, // last hour 2x pathis
    requiresHall: false,
    canBeOutsideGurdwara: true,
    compWeight: 6,
  });

  // Akhand Path (48h Path only, rotations + closing double)
  await upsertProgram('Akhand Path', ProgramCategory.PATH, {
    durationMinutes: 48 * 60,
    peopleRequired: 2, // rotations + closing double, no Kirtan
    minPathers: 1,
    minKirtanis: 0,
    trailingKirtanMinutes: 0,
    pathRotationMinutes: 120,
    pathClosingDoubleMinutes: 60,
    requiresHall: false,
    canBeOutsideGurdwara: true,
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
