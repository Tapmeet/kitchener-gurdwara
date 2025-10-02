/*
  Warnings:

  - You are about to drop the column `defaultMinutes` on the `ProgramType` table. All the data in the column will be lost.
  - You are about to drop the column `requiresGranthi` on the `ProgramType` table. All the data in the column will be lost.
  - You are about to drop the column `requiresRagi` on the `ProgramType` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."ProgramType" DROP COLUMN "defaultMinutes",
DROP COLUMN "requiresGranthi",
DROP COLUMN "requiresRagi";
