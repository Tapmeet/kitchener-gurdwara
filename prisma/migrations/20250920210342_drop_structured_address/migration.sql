/*
  Warnings:

  - You are about to drop the column `addressCity` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `addressCountry` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `addressLat` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `addressLng` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `addressPostal` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `addressProvince` on the `Booking` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Booking" DROP COLUMN "addressCity",
DROP COLUMN "addressCountry",
DROP COLUMN "addressLat",
DROP COLUMN "addressLng",
DROP COLUMN "addressPostal",
DROP COLUMN "addressProvince";
