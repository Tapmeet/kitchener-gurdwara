-- DropIndex
DROP INDEX "public"."Booking_hallId_idx";

-- AlterTable
ALTER TABLE "public"."Booking" ADD COLUMN     "addressCity" TEXT,
ADD COLUMN     "addressCountry" TEXT,
ADD COLUMN     "addressLat" DOUBLE PRECISION,
ADD COLUMN     "addressLng" DOUBLE PRECISION,
ADD COLUMN     "addressPostal" TEXT,
ADD COLUMN     "addressProvince" TEXT;
