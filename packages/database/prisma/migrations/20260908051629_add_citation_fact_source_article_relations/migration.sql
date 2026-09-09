-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_factId_fkey" FOREIGN KEY ("factId") REFERENCES "facts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_sourceArticleId_fkey" FOREIGN KEY ("sourceArticleId") REFERENCES "source_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
