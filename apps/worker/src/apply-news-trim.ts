import { prisma } from "@automotive/database";
import { qualityGateThresholds } from "@automotive/config";
import { evaluateQualityGate, type QualityScores } from "@automotive/editorial";

// Real decision, user's own explicit call (2026-09-12, after reviewing
// score-news-corpus.ts's real output): site is 4 days old (first
// publishedAt 2026-09-08), so there's essentially no real indexed
// equity to protect — DRAFT (a real 404, real sitemap removal, fully
// reversible) is simpler and just as safe here as noindex would be for
// an older site. Keeps the strongest ~20 real "publish"-verdict news
// pieces by their already-computed quality-gate score; everything else
// (all of "review" and "reject" too) goes back to DRAFT — not deleted,
// status flips back any time.
//
// One manual dedup: the raw top-20 by score included two near-duplicate
// Labor Day Segway scooter deal pieces (rank 6 and 17) — same real
// promotion, different SKU. Dropping the weaker one and letting rank 21
// fill the slot keeps 20 genuinely distinct real stories rather than
// 20 slots with one repeated topic.
const KEEP_COUNT = 20;
const MANUAL_DROP_HEADLINE_SUBSTRING = "Segway ZT3 Pro scooter at $850";

async function main() {
  const articles = await prisma.article.findMany({
    where: { status: "PUBLISHED", locale: "en", type: { in: ["NEWS", "BREAKING_NEWS"] } },
    select: {
      id: true,
      slug: true,
      headline: true,
      qualityScore: true,
      originalityScore: true,
      factualScore: true,
      sourceScore: true,
      valueScore: true,
      readabilityScore: true,
    },
  });

  const ranked = articles
    .map((a) => {
      if (a.factualScore === null || a.sourceScore === null) return null;
      const scores: QualityScores = {
        qualityScore: a.qualityScore ?? 0,
        originalityScore: a.originalityScore ?? 0,
        factualScore: a.factualScore,
        sourceScore: a.sourceScore,
        valueScore: a.valueScore ?? 0,
        readabilityScore: a.readabilityScore ?? 0,
      };
      const gate = evaluateQualityGate(scores, qualityGateThresholds);
      return { id: a.id, headline: a.headline, slug: a.slug, overallScore: gate.overallScore };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.overallScore - a.overallScore)
    .filter((a) => !a.headline.includes(MANUAL_DROP_HEADLINE_SUBSTRING));

  const keep = ranked.slice(0, KEEP_COUNT);
  const drop = ranked.slice(KEEP_COUNT);
  const keepIds = new Set(keep.map((a) => a.id));

  console.log(`Keeping ${keep.length} published, dropping ${drop.length} to DRAFT, out of ${articles.length} total.\n`);
  console.log("KEEPING (published, indexable):");
  keep.forEach((a, i) => console.log(`  ${i + 1}. ${a.overallScore.toFixed(1)}  ${a.headline}`));

  const idsToUnpublish = articles.map((a) => a.id).filter((id) => !keepIds.has(id));
  const result = await prisma.article.updateMany({
    where: { id: { in: idsToUnpublish } },
    data: { status: "DRAFT" },
  });
  console.log(`\nDone: ${result.count} article(s) moved to DRAFT (removed from sitemap and public site, not deleted — reversible).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
