/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `Staff` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "public"."Jatha" AS ENUM ('A', 'B');

-- AlterTable
ALTER TABLE "public"."Staff" ADD COLUMN     "email" TEXT,
ADD COLUMN     "jatha" "public"."Jatha",
ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "public"."Staff"("email");
