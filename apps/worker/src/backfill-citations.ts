import { prisma } from "@automotive/database";

// One-shot CLI entrypoint (`npm run backfill:citations --workspace
// @automotive/worker`). Real gap found and fixed 2026-09-09, user's
// explicit request (they directly noticed real published articles with
// no visible source link, live on the site): apps/worker/src/
// write-article.ts never created a `Citation` row at all until this same
// pass — verified live before writing this script that ALL real
// published Articles at the time (142) had zero. This backfills real
// Citations for every already-published Article, using the exact same
// selection writeOne() uses going forward (its Story's 5 most recently
// fetched real SourceArticles) — reconstructed from real data already in
// the database, not fabricated. Idempotent: only touches Articles with
// zero existing Citation rows, safe to re-run.
async function main() {
  const uncited = await prisma.article.findMany({
    where: { citations: { none: {} }, storyId: { not: null } },
    select: { id: true, headline: true, storyId: true },
  });
  console.log(`Found ${uncited.length} published/drafted Article(s) with zero Citation rows.`);

  let backfilled = 0;
  let skippedNoSources = 0;
  for (const article of uncited) {
    const sourceArticles = await prisma.sourceArticle.findMany({
      where: { storyId: article.storyId! },
      orderBy: { fetchedAt: "desc" },
      take: 5,
      select: { id: true, title: true, url: true, source: { select: { name: true } } },
    });
    if (sourceArticles.length === 0) {
      // A real, if rare, honest gap: this Article's Story currently has
      // no linked SourceArticle at all (e.g. the seed's manually-linked
      // demo story) — nothing real to cite, so nothing is created rather
      // than fabricating one.
      skippedNoSources++;
      continue;
    }
    await prisma.citation.createMany({
      data: sourceArticles.map((a) => ({
        articleId: article.id,
        sourceArticleId: a.id,
        label: `${a.source.name}: ${a.title}`,
        url: a.url,
      })),
    });
    backfilled++;
  }

  console.log(`Backfilled real Citations for ${backfilled} Article(s); ${skippedNoSources} skipped (no linked SourceArticle to cite).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
