-- CreateEnum
CREATE TYPE "ListingRejectionCode" AS ENUM ('DUPLICATE', 'SUSPECTED_FRAUD', 'POOR_PHOTOS', 'INCOMPLETE_DETAILS', 'PRICE_IMPLAUSIBLE', 'PROHIBITED_CONTENT', 'WRONG_CATEGORY', 'OTHER');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "buildingName" TEXT,
ADD COLUMN     "floorNumber" INTEGER,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionCode" "ListingRejectionCode",
ADD COLUMN     "unitNumber" TEXT;

-- CreateIndex
CREATE INDEX "Listing_city_buildingName_unitNumber_idx" ON "Listing"("city", "buildingName", "unitNumber");
