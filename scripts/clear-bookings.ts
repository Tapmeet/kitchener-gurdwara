// scripts/clear-bookings.ts
import 'dotenv/config';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DIRECT_URL or DATABASE_URL must be set in env');
}

const adapter = new PrismaNeon({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.$transaction([
    // prisma.bookingAssignment.deleteMany({}), // if you want to clear assignments too
    // prisma.bookingItem.deleteMany({}),
    prisma.booking.deleteMany({}),
  ]);

  console.log('✅ All bookings cleared');
}

main()
  .catch((e) => {
    console.error('❌ Failed to clear bookings', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// Dev:
// npx dotenv -e .env.local -- tsx scripts/clear-bookings.ts

// Preview:
// npx dotenv -e .env.preview -- tsx scripts/clear-bookings.ts
