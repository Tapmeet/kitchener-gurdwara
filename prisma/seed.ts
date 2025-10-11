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

    // smart scheduling fields
    trailingKirtanMinutes?: number; // jatha only at end
    pathRotationMinutes?: number; // path shifts (e.g. 120)
    pathClosingDoubleMinutes?: number; // last N minutes need 2 pathis
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

  // Sukhmani Sahib Path + Kirtan (1.5h total: 0.5–1h path + 1h kirtan at end)
  await upsertProgram('Sukhmani Sahib Path + Kirtan', ProgramCategory.PATH, {
    durationMinutes: 90,
    peopleRequired: 1, // path is one at a time
    minPathers: 1,
    minKirtanis: 0, // jatha only at end
    compWeight: 3,
    requiresHall: false,
    canBeOutsideGurdwara: true,
    trailingKirtanMinutes: 60,
    pathRotationMinutes: 0,
    pathClosingDoubleMinutes: 0,
  });

  // Sukhmani Sahib Path (no trailing kirtan)
  await upsertProgram('Sukhmani Sahib Path', ProgramCategory.PATH, {
    durationMinutes: 90,
    peopleRequired: 1,
    minPathers: 1,
    minKirtanis: 0,
    compWeight: 2,
    requiresHall: false,
    canBeOutsideGurdwara: true,
  });

  // Anand Karaj (concurrent path + kirtan throughout, hall-only)
  await upsertProgram('Anand Karaj', ProgramCategory.OTHER, {
    durationMinutes: 180,
    peopleRequired: 4,
    minPathers: 1,
    minKirtanis: 3, // full jatha all through
    compWeight: 4,
    requiresHall: true,
    canBeOutsideGurdwara: false,
  });

  // Akhand Path + Kirtan (49h total; path rotations + closing double + 1h kirtan at end)
  await upsertProgram('Akhand Path + Kirtan', ProgramCategory.PATH, {
    durationMinutes: 49 * 60,
    peopleRequired: 5, // overall crew size
    minPathers: 1, // at least 1 on-duty at any moment (except closing double)
    minKirtanis: 0, // jatha only at the end
    compWeight: 6,
    requiresHall: false,
    canBeOutsideGurdwara: true,
    trailingKirtanMinutes: 60, // bhog kirtan
    pathRotationMinutes: 120, // 2h shifts
    pathClosingDoubleMinutes: 60, // last 1h uses 2 pathis
  });

  // Alania Da Path (Antim Ardas) + Kirtan (2h total, kirtan at end)
  await upsertProgram(
    'Alania Da Path (Antim Ardas) + Kirtan',
    ProgramCategory.PATH,
    {
      durationMinutes: 120,
      peopleRequired: 1,
      minPathers: 1,
      minKirtanis: 0,
      compWeight: 3,
      requiresHall: false,
      canBeOutsideGurdwara: true,
      trailingKirtanMinutes: 60,
    }
  );

  // Assa Di War (pure kirtan)
  await upsertProgram('Assa Di War', ProgramCategory.KIRTAN, {
    durationMinutes: 180,
    peopleRequired: 3,
    minPathers: 0,
    minKirtanis: 3,
    compWeight: 4,
    requiresHall: false,
    canBeOutsideGurdwara: true,
  });

  // Kirtan (pure kirtan, 1h)
  await upsertProgram('Kirtan', ProgramCategory.KIRTAN, {
    durationMinutes: 60,
    peopleRequired: 3,
    minPathers: 0,
    minKirtanis: 3,
    compWeight: 1,
    requiresHall: false,
    canBeOutsideGurdwara: true,
  });

  // Akhand Path (48h PATH only; rotations + closing double)
  await upsertProgram('Akhand Path', ProgramCategory.PATH, {
    durationMinutes: 48 * 60,
    peopleRequired: 5, // <-- set to 5
    minPathers: 1,
    minKirtanis: 0,
    compWeight: 5,
    requiresHall: false,
    canBeOutsideGurdwara: true,
    trailingKirtanMinutes: 0,
    pathRotationMinutes: 120, // 2h shifts
    pathClosingDoubleMinutes: 60, // last 1h uses 2 pathis
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
