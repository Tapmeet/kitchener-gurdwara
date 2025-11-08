// scripts/clear-bookings.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Delete children first to satisfy FKs. Adjust model names if yours differ.
  // If you don't have some of these models, just delete that line.

  await prisma.$transaction([
    // prisma.assignment.deleteMany({}),      // e.g. staff assignments linked to a booking
    // prisma.bookingItem.deleteMany({}),     // e.g. programs/items linked to a booking
    prisma.booking.deleteMany({}), // the bookings themselves
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

//Dev
//npx dotenv -e .env.local -- tsx scripts/clear-bookings.ts

//Prod
//npx dotenv -e .env.production -- npx tsx scripts/clear-bookings.ts
