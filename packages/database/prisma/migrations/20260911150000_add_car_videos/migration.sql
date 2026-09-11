-- CreateEnum
CREATE TYPE "CarVideoCategory" AS ENUM ('OFFICIAL', 'CRASH_TEST', 'REVIEW');

-- CreateTable
CREATE TABLE "car_videos" (
    "id" TEXT NOT NULL,
    "carModelId" TEXT NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "CarVideoCategory" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "car_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "car_videos_carModelId_idx" ON "car_videos"("carModelId");

-- AddForeignKey
ALTER TABLE "car_videos" ADD CONSTRAINT "car_videos_carModelId_fkey" FOREIGN KEY ("carModelId") REFERENCES "car_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
