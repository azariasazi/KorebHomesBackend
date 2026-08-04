-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ListingStatus" ADD VALUE 'SOLD';
ALTER TYPE "ListingStatus" ADD VALUE 'RENTED';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "soldRentedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "suspendedAt" TIMESTAMP(3);
