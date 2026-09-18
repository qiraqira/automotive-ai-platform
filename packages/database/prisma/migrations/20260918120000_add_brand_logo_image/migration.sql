-- AlterTable
ALTER TABLE "brands" ADD COLUMN "logoImageId" TEXT;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_logoImageId_fkey" FOREIGN KEY ("logoImageId") REFERENCES "images"("id") ON DELETE SET NULL ON UPDATE CASCADE;
