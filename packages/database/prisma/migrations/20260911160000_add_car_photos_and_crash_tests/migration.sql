-- CreateEnum
CREATE TYPE "CrashTestOrganization" AS ENUM ('EURO_NCAP', 'IIHS', 'NHTSA');

-- CreateTable
CREATE TABLE "car_model_images" (
    "id" TEXT NOT NULL,
    "carModelId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "role" "ArticleImageRole" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "altText" TEXT,

    CONSTRAINT "car_model_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crash_test_results" (
    "id" TEXT NOT NULL,
    "carModelId" TEXT NOT NULL,
    "generationId" TEXT,
    "organization" "CrashTestOrganization" NOT NULL,
    "overallRating" TEXT NOT NULL,
    "categoryScores" JSONB,
    "testYear" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "videoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crash_test_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crash_test_results_carModelId_idx" ON "crash_test_results"("carModelId");

-- AddForeignKey
ALTER TABLE "car_model_images" ADD CONSTRAINT "car_model_images_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "car_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "car_model_images" ADD CONSTRAINT "car_model_images_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "images"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crash_test_results" ADD CONSTRAINT "crash_test_results_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "car_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crash_test_results" ADD CONSTRAINT "crash_test_results_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crash_test_results" ADD CONSTRAINT "crash_test_results_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "car_videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
