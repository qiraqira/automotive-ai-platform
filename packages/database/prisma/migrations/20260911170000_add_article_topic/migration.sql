-- AlterTable
ALTER TABLE "articles" ADD COLUMN "topicId" TEXT;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
