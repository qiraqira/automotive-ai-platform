-- DropIndex
DROP INDEX "source_articles_title_trgm_idx";

-- CreateIndex
CREATE INDEX "search_queries_createdAt_idx" ON "search_queries"("createdAt");

-- CreateIndex
CREATE INDEX "stories_lastUpdatedAt_idx" ON "stories"("lastUpdatedAt");

-- CreateIndex
CREATE INDEX "system_alerts_createdAt_idx" ON "system_alerts"("createdAt");
