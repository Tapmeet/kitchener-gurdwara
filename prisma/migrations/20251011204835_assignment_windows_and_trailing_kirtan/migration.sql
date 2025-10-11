-- AlterTable
ALTER TABLE "public"."BookingAssignment" ADD COLUMN     "end" TIMESTAMP(3),
ADD COLUMN     "start" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "public"."ProgramType" ADD COLUMN     "pathClosingDoubleMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pathRotationMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trailingKirtanMinutes" INTEGER NOT NULL DEFAULT 0;
