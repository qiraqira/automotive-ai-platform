-- AddForeignKey
ALTER TABLE "source_authors" ADD CONSTRAINT "source_authors_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
