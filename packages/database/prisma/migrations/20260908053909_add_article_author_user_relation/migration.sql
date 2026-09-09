-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
