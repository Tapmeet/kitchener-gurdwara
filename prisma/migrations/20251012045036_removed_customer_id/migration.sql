/*
  Warnings:

  - You are about to drop the column `customerId` on the `Booking` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Booking" DROP CONSTRAINT "Booking_customerId_fkey";

-- AlterTable
ALTER TABLE "public"."Booking" DROP COLUMN "customerId";
