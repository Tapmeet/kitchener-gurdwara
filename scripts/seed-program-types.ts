// scripts/seed-program-types.ts
import 'dotenv/config';
import { PrismaClient, ProgramCategory } from '@/generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString)
  throw new Error('DIRECT_URL or DATABASE_URL must be set in env');

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.programType.upsert({
    where: { name: 'Sehaj Path' },
    update: {
      category: ProgramCategory.PATH,
      durationMinutes: 48 * 60,
      peopleRequired: 2,
      minPathers: 1,
      minKirtanis: 0,
      trailingKirtanMinutes: 0,
      pathRotationMinutes: 0,
      pathClosingDoubleMinutes: 0,
      requiresHall: false,
      canBeOutsideGurdwara: true,
      isActive: true,
      compWeight: 4,
    },
    create: {
      name: 'Sehaj Path',
      category: ProgramCategory.PATH,
      durationMinutes: 48 * 60,
      peopleRequired: 2,
      minPathers: 1,
      minKirtanis: 0,
      trailingKirtanMinutes: 0,
      pathRotationMinutes: 0,
      pathClosingDoubleMinutes: 0,
      requiresHall: false,
      canBeOutsideGurdwara: true,
      isActive: true,
      compWeight: 4,
    },
  });

  await prisma.programType.upsert({
    where: { name: 'Sehaj Path + Kirtan' },
    update: {
      category: ProgramCategory.PATH,
      durationMinutes: 49 * 60,
      peopleRequired: 3,
      minPathers: 1,
      minKirtanis: 0,
      trailingKirtanMinutes: 60,
      pathRotationMinutes: 0,
      pathClosingDoubleMinutes: 0,
      requiresHall: false,
      canBeOutsideGurdwara: true,
      isActive: true,
      compWeight: 5,
    },
    create: {
      name: 'Sehaj Path + Kirtan',
      category: ProgramCategory.PATH,
      durationMinutes: 49 * 60,
      peopleRequired: 3,
      minPathers: 1,
      minKirtanis: 0,
      trailingKirtanMinutes: 60,
      pathRotationMinutes: 0,
      pathClosingDoubleMinutes: 0,
      requiresHall: false,
      canBeOutsideGurdwara: true,
      isActive: true,
      compWeight: 5,
    },
  });

  console.log('✅ Program types upserted (Sehaj only)');
}

main()
  .catch((e) => {
    console.error('❌ Failed to seed program types', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
