/*
  Warnings:

  - You are about to alter the column `contactEmail` on the `Booking` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(320)`.

*/
-- AlterTable
ALTER TABLE "public"."Booking" ALTER COLUMN "contactEmail" SET DATA TYPE VARCHAR(320);
