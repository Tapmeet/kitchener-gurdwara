-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'SECRETARY', 'GRANTHI', 'LANGRI', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."LocationType" AS ENUM ('GURDWARA', 'OUTSIDE_GURDWARA');

-- CreateEnum
CREATE TYPE "public"."ProgramCategory" AS ENUM ('KIRTAN', 'PATH', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."StaffSkill" AS ENUM ('PATH', 'KIRTAN');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "role" "public"."UserRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Hall" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProgramType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "public"."ProgramCategory" NOT NULL,
    "defaultMinutes" INTEGER NOT NULL DEFAULT 120,
    "requiresHall" BOOLEAN NOT NULL DEFAULT true,
    "requiresRagi" INTEGER NOT NULL DEFAULT 0,
    "requiresGranthi" INTEGER NOT NULL DEFAULT 0,
    "canBeOutsideGurdwara" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "durationMinutes" INTEGER NOT NULL DEFAULT 120,
    "minPathers" INTEGER NOT NULL DEFAULT 0,
    "minKirtanis" INTEGER NOT NULL DEFAULT 0,
    "peopleRequired" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProgramType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Booking" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "locationType" "public"."LocationType" NOT NULL,
    "hallId" TEXT,
    "attendees" INTEGER NOT NULL DEFAULT 1,
    "address" TEXT,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingItem" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "programTypeId" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "BookingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Staff" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "skills" "public"."StaffSkill"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BookingAssignment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "bookingItemId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Hall_name_key" ON "public"."Hall"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramType_name_key" ON "public"."ProgramType"("name");

-- CreateIndex
CREATE INDEX "Booking_start_end_idx" ON "public"."Booking"("start", "end");

-- CreateIndex
CREATE INDEX "BookingItem_programTypeId_idx" ON "public"."BookingItem"("programTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingItem_bookingId_programTypeId_key" ON "public"."BookingItem"("bookingId", "programTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_name_key" ON "public"."Staff"("name");

-- CreateIndex
CREATE INDEX "BookingAssignment_bookingId_idx" ON "public"."BookingAssignment"("bookingId");

-- CreateIndex
CREATE INDEX "BookingAssignment_staffId_idx" ON "public"."BookingAssignment"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingAssignment_bookingItemId_staffId_key" ON "public"."BookingAssignment"("bookingItemId", "staffId");

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "public"."Hall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Booking" ADD CONSTRAINT "Booking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingItem" ADD CONSTRAINT "BookingItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingItem" ADD CONSTRAINT "BookingItem_programTypeId_fkey" FOREIGN KEY ("programTypeId") REFERENCES "public"."ProgramType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingAssignment" ADD CONSTRAINT "BookingAssignment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "public"."Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingAssignment" ADD CONSTRAINT "BookingAssignment_bookingItemId_fkey" FOREIGN KEY ("bookingItemId") REFERENCES "public"."BookingItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BookingAssignment" ADD CONSTRAINT "BookingAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "public"."Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
