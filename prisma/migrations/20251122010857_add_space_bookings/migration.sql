-- CreateEnum
CREATE TYPE "public"."SpaceRecurrence" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "public"."SpaceBooking" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "locationType" "public"."LocationType" NOT NULL,
    "hallId" TEXT,
    "blocksHall" BOOLEAN NOT NULL DEFAULT true,
    "isPublicTitle" BOOLEAN NOT NULL DEFAULT true,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "recurrence" "public"."SpaceRecurrence" NOT NULL DEFAULT 'ONCE',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "until" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpaceBooking_start_end_idx" ON "public"."SpaceBooking"("start", "end");

-- CreateIndex
CREATE INDEX "SpaceBooking_recurrence_idx" ON "public"."SpaceBooking"("recurrence");

-- CreateIndex
CREATE INDEX "SpaceBooking_isActive_idx" ON "public"."SpaceBooking"("isActive");

-- AddForeignKey
ALTER TABLE "public"."SpaceBooking" ADD CONSTRAINT "SpaceBooking_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "public"."Hall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SpaceBooking" ADD CONSTRAINT "SpaceBooking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
