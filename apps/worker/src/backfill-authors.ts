import { prisma } from "@automotive/database";
import { parseFeed } from "./rss.js";
import { normalizeUrl, hashUrl } from "./url.js";
import { resolveSourceAuthor } from "./ingest.js";

// One-shot CLI entrypoint (`npm run backfill:authors --workspace apps/worker`),
// same idempotent-backfill shape as this file's sibling `backfill-topics.ts`.
// `ingestSource()`'s real byline extraction (2026-09-07) only resolves an
// author at the moment an item is first ingested, so every SourceArticle
// ingested before that landed has `authorId: null` — not because its
// source provides no author, just because nothing looked yet.
//
// Real, structural limitation this backfill can't get around (unlike the
// topic backfill, which only ever needed already-stored title text): RSS
// feeds only carry their most recent items (electrek.co's real feed caps
// at 100), and this project deliberately never mirrors full feed content
// (docs/security.md "no full-text mirroring") — so this can only recover
// authors for articles still within each source's *current* feed window,
// matched back to already-ingested rows by the same urlHash `ingestSource()`
// itself uses. Older rows that have scrolled out of the feed are gone for
// good; this is an honest partial recovery, not silently pretending to be
// complete.
async function main() {
  const sources = await prisma.source.findMany({ where: { active: true, feedUrl: { not: null } } });
  console.log(`Checking ${sources.length} active source(s) with a feed for backfillable authors...`);

  const counts = { updated: 0, noAuthorInFeed: 0, notMatchedToAnAuthorlessArticle: 0 };

  for (const source of sources) {
    let items;
    try {
      const res = await fetch(source.feedUrl!, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AutomotivePlatformBot/0.1)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = parseFeed(await res.text());
    } catch (err) {
      console.error(`[${source.name}] fetch/parse failed, skipping:`, err instanceof Error ? err.message : err);
      continue;
    }

    const existingArticles = await prisma.sourceArticle.findMany({
      where: { sourceId: source.id, authorId: null },
      select: { id: true, urlHash: true },
    });
    const existingByHash = new Map(existingArticles.map((a) => [a.urlHash, a]));

    for (const item of items) {
      if (!item.author) {
        counts.noAuthorInFeed += 1;
        continue;
      }
      const urlHash = hashUrl(normalizeUrl(item.link));
      const article = existingByHash.get(urlHash);
      if (!article) {
        // Either not ingested yet, or this SourceArticle already has an
        // author (excluded from `existingByHash` by the query above).
        counts.notMatchedToAnAuthorlessArticle += 1;
        continue;
      }

      const authorId = await resolveSourceAuthor(source.id, item.author);
      await prisma.sourceArticle.update({ where: { id: article.id }, data: { authorId } });
      counts.updated += 1;
    }
  }

  console.log("Backfilled:", counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
