/*
  Warnings:

  - A unique constraint covering the columns `[bookingItemId,staffId,start,end]` on the table `BookingAssignment` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."AssignmentState" AS ENUM ('PROPOSED', 'CONFIRMED');

-- DropIndex
DROP INDEX "public"."BookingAssignment_bookingId_idx";

-- DropIndex
DROP INDEX "public"."BookingAssignment_bookingItemId_staffId_key";

-- DropIndex
DROP INDEX "public"."BookingAssignment_staffId_idx";

-- AlterTable
ALTER TABLE "public"."BookingAssignment" ADD COLUMN     "state" "public"."AssignmentState" NOT NULL DEFAULT 'PROPOSED';

-- CreateIndex
CREATE INDEX "BookingAssignment_bookingId_start_end_idx" ON "public"."BookingAssignment"("bookingId", "start", "end");

-- CreateIndex
CREATE INDEX "BookingAssignment_staffId_start_end_idx" ON "public"."BookingAssignment"("staffId", "start", "end");

-- CreateIndex
CREATE INDEX "BookingAssignment_staffId_state_idx" ON "public"."BookingAssignment"("staffId", "state");

-- CreateIndex
CREATE INDEX "BookingAssignment_bookingId_state_idx" ON "public"."BookingAssignment"("bookingId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "BookingAssignment_bookingItemId_staffId_start_end_key" ON "public"."BookingAssignment"("bookingItemId", "staffId", "start", "end");
