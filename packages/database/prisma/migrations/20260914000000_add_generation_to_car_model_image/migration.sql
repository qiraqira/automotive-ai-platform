-- AlterTable
ALTER TABLE "car_model_images" ADD COLUMN "generationId" TEXT;

-- AddForeignKey
ALTER TABLE "car_model_images" ADD CONSTRAINT "car_model_images_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
