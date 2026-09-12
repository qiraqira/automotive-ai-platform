import { prisma } from "@automotive/database";
import { qualityGateThresholds } from "@automotive/config";
import { evaluateQualityGate, type QualityScores } from "@automotive/editorial";

// Read-only, no AI calls: ranks every published NEWS/BREAKING_NEWS
// article by its already-stored real quality-gate scores, to find a
// natural cutoff for "keep this one indexed" vs "pull the rest back to
// DRAFT" (user's own request, 2026-09-12 — site is 4 days old, so
// there's minimal indexed equity to protect either way).
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
      return { headline: a.headline, slug: a.slug, overallScore: gate.overallScore, verdict: gate.verdict };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.overallScore - a.overallScore);

  console.log(`Scored ${ranked.length} of ${articles.length} published NEWS/BREAKING_NEWS articles (rest have no stored scores).\n`);
  ranked.forEach((a, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${a.overallScore.toFixed(1).padStart(5)}  [${a.verdict.padEnd(6)}]  ${a.headline}`);
  });

  // Real gap-finding: the biggest single drop in score between adjacent
  // ranked articles, restricted to a plausible "keep between 10 and 30"
  // window rather than the absolute biggest gap anywhere in the list.
  let biggestGap = { afterRank: 0, size: 0 };
  for (let i = 9; i < Math.min(30, ranked.length - 1); i++) {
    const current = ranked[i];
    const next = ranked[i + 1];
    if (!current || !next) continue;
    const gap = current.overallScore - next.overallScore;
    if (gap > biggestGap.size) biggestGap = { afterRank: i + 1, size: gap };
  }
  console.log(`\nLargest score drop between rank 10-30: after #${biggestGap.afterRank} (drop of ${biggestGap.size.toFixed(1)} points, from ${ranked[biggestGap.afterRank - 1]?.overallScore.toFixed(1)} to ${ranked[biggestGap.afterRank]?.overallScore.toFixed(1)}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
