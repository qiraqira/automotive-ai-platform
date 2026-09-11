import { prisma } from "@automotive/database";
import { qualityGateThresholds } from "@automotive/config";
import { evaluateQualityGate } from "@automotive/editorial";
import { factCheckArticle } from "./fact-check.js";

// Real, user-requested audit (2026-09-12): "убедись что статьи все
// переписываются на очень хорошие как у журналистов" (make sure
// articles are being rewritten to real journalist quality) — the only
// honest way to answer that is to actually re-check the published
// corpus with the just-upgraded, stronger fact-checker (Sonnet 5 + real
// web search), not to assert it. Read-only: this NEVER writes a new
// status/score back onto a live article — it only reports what the
// upgraded checker finds, so a human decision (rewrite, unpublish,
// leave alone) follows from real data instead of this script silently
// taking that decision itself for 150+ already-live, indexed URLs.
async function main() {
  const articles = await prisma.article.findMany({
    where: { status: "PUBLISHED", locale: "en" },
    orderBy: { publishedAt: "desc" },
    include: {
      blocks: { where: { type: "TEXT" }, orderBy: { position: "asc" } },
      citations: true,
    },
  });

  console.log(`Auditing ${articles.length} published article(s) with the upgraded (Sonnet 5 + web search) fact-checker...\n`);

  const results: { slug: string; headline: string; oldScore: number | null; newScore: number; verdict: string; concerns: string }[] = [];

  for (const article of articles) {
    const paragraphs = article.blocks.map((b) => (b.data as { text?: string }).text ?? "").filter(Boolean);
    if (paragraphs.length === 0) {
      console.log(`- skipping "${article.headline}" (no TEXT blocks — likely a SPEC_TABLE-only piece not fit for this text-only re-check)`);
      continue;
    }
    const sourcesBlock = article.citations.map((c, i) => `${i + 1}. ${c.label}`).join("\n") || "(no citations on file)";

    // Reuse the real evaluateQualityGate() weighting (packages/editorial)
    // for the "old" score too, rather than guessing weights — this is
    // exactly the same function write-article.ts's own fact-check pass
    // already scored this article with originally.
    const oldScore =
      article.factualScore !== null && article.sourceScore !== null
        ? evaluateQualityGate(
            {
              qualityScore: article.qualityScore ?? 0,
              originalityScore: article.originalityScore ?? 0,
              factualScore: article.factualScore,
              sourceScore: article.sourceScore,
              valueScore: article.valueScore ?? 0,
              readabilityScore: article.readabilityScore ?? 0,
            },
            qualityGateThresholds,
          ).overallScore
        : null;

    try {
      const result = await factCheckArticle(article.id, article.headline, article.subtitle, paragraphs, sourcesBlock, qualityGateThresholds);
      if (!result) {
        // Real bug found live 2026-09-12: factCheckArticle() returns
        // null for a real budget block AND for any other internal
        // error (both cases already logged their own specific reason
        // inside fact-check.ts itself) — treating every null as "budget
        // exhausted" and stopping the whole audit here was wrong: the
        // first real run hit a transient per-article API error (since
        // fixed) on article 1 and this line stopped the ENTIRE 151-
        // article audit right there, reporting "0 re-checked". Skip and
        // keep going — if the daily/monthly budget is genuinely
        // exhausted, every remaining call will fail the same cheap,
        // fast pre-flight check rather than silently truncating a real
        // audit over one bad article.
        console.log(`- "${article.headline}": fact-check returned no result (see its own log line above for why) — skipping, continuing audit.`);
        continue;
      }
      results.push({
        slug: article.slug,
        headline: article.headline,
        oldScore,
        newScore: result.gate.overallScore,
        verdict: result.gate.verdict,
        concerns: result.concerns,
      });
      console.log(
        `${result.gate.verdict === "publish" ? "OK" : result.gate.verdict === "review" ? "REVIEW" : "REJECT"} (was ${oldScore !== null ? oldScore.toFixed(1) : "n/a"} -> now ${result.gate.overallScore.toFixed(1)}) "${article.headline}" — ${result.concerns}`,
      );
    } catch (err) {
      console.error(`- "${article.headline}": audit call failed —`, err instanceof Error ? err.message : err);
    }
  }

  const reject = results.filter((r) => r.verdict === "reject");
  const review = results.filter((r) => r.verdict === "review");
  const ok = results.filter((r) => r.verdict === "publish");

  console.log(`\n=== SUMMARY: ${results.length} article(s) re-checked ===`);
  console.log(`OK (publish-worthy): ${ok.length}`);
  console.log(`REVIEW (weak, real concerns): ${review.length}`);
  console.log(`REJECT (real quality/factual problems): ${reject.length}`);
  if (review.length + reject.length > 0) {
    console.log(`\n--- Articles flagged for review/reject ---`);
    for (const r of [...reject, ...review]) {
      console.log(`[${r.verdict.toUpperCase()}] ${r.headline} (/articles/en/${r.slug})\n   ${r.concerns}`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
