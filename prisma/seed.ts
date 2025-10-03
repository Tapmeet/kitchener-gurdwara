
// prisma/seed.ts
import "dotenv/config";
import { PrismaClient, ProgramCategory, StaffSkill, Jatha } from "@prisma/client";
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
  }
) {
  const { durationMinutes, peopleRequired, minPathers, minKirtanis, requiresHall = false, canBeOutsideGurdwara = true } = opts;
  await prisma.programType.upsert({
    where: { name },
    update: { category, durationMinutes, peopleRequired, minPathers, minKirtanis, requiresHall, canBeOutsideGurdwara, isActive: true },
    create: { name, category, durationMinutes, peopleRequired, minPathers, minKirtanis, requiresHall, canBeOutsideGurdwara, isActive: true },
  });
}

async function upsertStaff(name: string, skills: StaffSkill[], opts?: { jatha?: Jatha; email?: string; phone?: string }) {
  await prisma.staff.upsert({
    where: { name },
    update: { skills, isActive: true, jatha: opts?.jatha, email: opts?.email, phone: opts?.phone },
    create: { name, skills, isActive: true, jatha: opts?.jatha ?? null, email: opts?.email ?? null, phone: opts?.phone ?? null },
  });
}

async function main() {
  // Halls
  await upsertHall("Small Hall", 125);
  await upsertHall("Main Hall", 350);
  await upsertHall("Upper Hall", 100);

  // Staff
  await upsertStaff("Granthi", [StaffSkill.PATH], { email: "granthi@example.com", phone: "+11234567890" });

  await Promise.all([
    upsertStaff("Sevadar A1", [StaffSkill.KIRTAN, StaffSkill.PATH], { jatha: Jatha.A, email: "sevadar1@example.com", phone: "+11111111111" }),
    upsertStaff("Sevadar A2", [StaffSkill.KIRTAN, StaffSkill.PATH], { jatha: Jatha.A, email: "sevadar2@example.com", phone: "+12222222222" }),
    upsertStaff("Sevadar A3", [StaffSkill.KIRTAN, StaffSkill.PATH], { jatha: Jatha.A, email: "sevadar3@example.com", phone: "+13333333333" }),
    upsertStaff("Sevadar B1", [StaffSkill.KIRTAN, StaffSkill.PATH], { jatha: Jatha.B, email: "sevadar4@example.com", phone: "+14444444444" }),
    upsertStaff("Sevadar B2", [StaffSkill.KIRTAN, StaffSkill.PATH], { jatha: Jatha.B, email: "sevadar5@example.com", phone: "+15555555555" }),
    upsertStaff("Sevadar B3", [StaffSkill.KIRTAN, StaffSkill.PATH], { jatha: Jatha.B, email: "sevadar6@example.com", phone: "+16666666666" }),
    upsertStaff("Path-only Sevadar", [StaffSkill.PATH]),
  ]);

  // Program Types
  await upsertProgram("Sukhmani Sahib Path", ProgramCategory.PATH, { durationMinutes: 90, peopleRequired: 1, minPathers: 1, minKirtanis: 0 });
  await upsertProgram("Sukhmani Sahib Path With Kirtan", ProgramCategory.PATH, { durationMinutes: 120, peopleRequired: 3, minPathers: 1, minKirtanis: 1 });
  await upsertProgram("Akhand Path", ProgramCategory.PATH, { durationMinutes: 48 * 60, peopleRequired: 4, minPathers: 4, minKirtanis: 0 });
  await upsertProgram("Akhand Path with Kirtan", ProgramCategory.PATH, { durationMinutes: 49 * 60, peopleRequired: 4, minPathers: 4, minKirtanis: 1 });
  await upsertProgram("Assa Di War", ProgramCategory.KIRTAN, { durationMinutes: 180, peopleRequired: 4, minPathers: 0, minKirtanis: 3 });
  await upsertProgram("Anand Karaj", ProgramCategory.OTHER, { durationMinutes: 180, peopleRequired: 4, minPathers: 1, minKirtanis: 1, requiresHall: true, canBeOutsideGurdwara: false });
  await upsertProgram("Kirtan", ProgramCategory.KIRTAN, { durationMinutes: 60, peopleRequired: 3, minPathers: 0, minKirtanis: 3 });

  console.log("✅ Seed completed");
}

main().catch((e) => {
  console.error("❌ Seed failed", e);
  process.exit(1);
}).finally(async () => { await prisma.$disconnect(); });
