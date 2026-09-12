import { prisma } from "@automotive/database";
import { budgetLimits, qualityGateThresholds } from "@automotive/config";
import { assertWithinBudget, recordExecution, handleBudgetExceeded, BudgetExceededError, createTextProvider } from "@automotive/ai";
import { evaluateQualityGate } from "@automotive/editorial";
import { factCheckArticle } from "./fact-check.js";

// Real, user-requested batch regeneration (2026-09-12): the corpus
// audit (audit-published-quality.ts) found 124 of 151 published
// articles had real, verifiable problems — mostly the old Haiku writer
// leaving out specifics that were actually available in the sources,
// some genuine factual errors. Rather than hardcode that specific
// 124-slug list (frozen the moment the old, now-replaced Sonnet-based
// audit ran), this reprocesses every real pipeline-written NEWS/
// BREAKING_NEWS article uniformly through the new writer+fact-checker
// (GPT-5.6 Luna, both roles — see openai-provider.ts's own comment for
// the real A/B test behind that choice) — comparisons/guides/analysis
// are hand-authored (seed-real-articles.ts), have no Story to
// regenerate from, and are deliberately excluded here.
//
// Never blind-overwrites: only replaces an article's TEXT content if
// the regenerated draft's own fact-check score is at or above the
// current stored score (or the current score doesn't exist), logging
// every real decision either way.

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "A concise, factual news headline, under 100 characters." },
    subtitle: { type: "string", description: "One sentence expanding on the headline." },
    keyTakeaway: { type: "string", description: "The single most important fact, in one sentence." },
    paragraphs: {
      type: "array",
      items: { type: "string" },
      description: "The article body, as 4 to 8 original paragraphs of plain prose (no markdown) — long enough to actually use whatever real additional context was found, never padded just to hit a count.",
    },
  },
  required: ["headline", "subtitle", "keyTakeaway", "paragraphs"],
  additionalProperties: false,
};

interface WriterOutput {
  headline: string;
  subtitle: string;
  keyTakeaway: string;
  paragraphs: string[];
}

const CHEAP_MODEL_INPUT_COST_PER_M = 0.2;
const CHEAP_MODEL_OUTPUT_COST_PER_M = 1.2;
const WEB_SEARCH_COST_PER_CALL = 0.01;
const WRITE_WEB_SEARCH_MAX_USES = 1;

async function regenerateOne(article: {
  id: string;
  slug: string;
  headline: string;
  factualScore: number | null;
  sourceScore: number | null;
  qualityScore: number | null;
  originalityScore: number | null;
  valueScore: number | null;
  readabilityScore: number | null;
}): Promise<void> {
  const story = await prisma.article.findUnique({ where: { id: article.id }, select: { storyId: true } });
  if (!story?.storyId) {
    console.log(`- "${article.headline}": no storyId, skipping (not a pipeline-written article).`);
    return;
  }

  const storyData = await prisma.story.findUnique({
    where: { id: story.storyId },
    select: {
      id: true,
      title: true,
      summary: true,
      sourceArticles: {
        take: 5,
        orderBy: { fetchedAt: "desc" },
        select: { id: true, title: true, url: true, excerpt: true, source: { select: { name: true } } },
      },
    },
  });
  if (!storyData || storyData.sourceArticles.length === 0) {
    console.log(`- "${article.headline}": no real Story/sources found, skipping.`);
    return;
  }

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

  const sourcesBlock = storyData.sourceArticles.map((a, i) => `${i + 1}. [${a.source.name}] "${a.title}"${a.excerpt ? ` — ${a.excerpt}` : ""}`).join("\n");
  const prompt = `Story title: ${storyData.title}
${storyData.summary ? `Known summary: ${storyData.summary}\n` : ""}
Source headlines/excerpts (real ground truth from this platform's own ingestion):
${sourcesBlock}

Before writing, use web search to find genuinely new, real, current context beyond what's in the sources above — other outlets' coverage of the same story, the real current spec/price/date if the story turns on one, or real relevant background. Only search for something that would actually change or enrich what you write; skip it if the sources above already fully cover the story. Never copy any source's wording verbatim, and never fabricate a fact beyond what the sources or a real search result actually state. Write a real, original automotive-news article synthesizing all of it.`;
  const system =
    "You are a factual automotive news writer for an editorial platform with real web search available, whose core rule is: never reproduce a source's wording, only synthesize real facts into original prose. Stay strictly within the facts given or found via a real search — never invent a spec, date, price, or quote. Neutral, concise, journalistic tone, but genuinely informative rather than a bare rewrite of the shortest possible summary. Respond with JSON matching the given schema, and nothing else.";

  const estimatedCostUsd = 0.02 + WRITE_WEB_SEARCH_MAX_USES * WEB_SEARCH_COST_PER_CALL;
  try {
    await assertWithinBudget(estimatedCostUsd, budgetLimits);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      await handleBudgetExceeded((await prisma.aIJob.create({ data: { type: "WRITE_ARTICLE", status: "PENDING", storyId: storyData.id, input: { purpose: "regenerate", articleId: article.id } } })).id, err);
      console.log(`- "${article.headline}": budget guard blocked regeneration.`);
      return;
    }
    throw err;
  }

  const job = await prisma.aIJob.create({
    data: { type: "WRITE_ARTICLE", status: "RUNNING", storyId: storyData.id, input: { purpose: "regenerate", articleId: article.id } },
  });

  const provider = createTextProvider();
  let result: WriterOutput;
  const start = Date.now();
  try {
    const completion = await provider.complete({
      system,
      prompt,
      responseSchema: RESPONSE_SCHEMA,
      maxTokens: 4096,
      webSearch: { maxUses: WRITE_WEB_SEARCH_MAX_USES },
    });
    result = JSON.parse(completion.text) as WriterOutput;
    const realCostUsd =
      (completion.tokensIn / 1_000_000) * CHEAP_MODEL_INPUT_COST_PER_M +
      (completion.tokensOut / 1_000_000) * CHEAP_MODEL_OUTPUT_COST_PER_M +
      (completion.webSearchCount ?? 0) * WEB_SEARCH_COST_PER_CALL;
    await recordExecution({
      jobId: job.id,
      provider: provider.name,
      model: completion.model,
      tokensIn: completion.tokensIn,
      tokensOut: completion.tokensOut,
      estimatedCostUsd: realCostUsd,
      latencyMs: Date.now() - start,
      success: true,
    });
  } catch (err) {
    await prisma.aIJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date() } });
    console.error(`- "${article.headline}": regeneration write failed —`, err instanceof Error ? err.message : err);
    return;
  }
  await prisma.aIJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date() } });

  const newSourcesBlock = storyData.sourceArticles.map((a, i) => `${i + 1}. ${a.source.name}: ${a.title}`).join("\n");
  const fc = await factCheckArticle(article.id, result.headline, result.subtitle, result.paragraphs, newSourcesBlock, qualityGateThresholds);
  if (!fc) {
    console.log(`- "${article.headline}": new draft's fact-check returned no result, leaving original untouched.`);
    return;
  }

  console.log(
    `"${article.headline}" — new verdict ${fc.gate.verdict} (${fc.gate.overallScore.toFixed(1)}), old score ${oldScore !== null ? oldScore.toFixed(1) : "n/a"}: ${fc.concerns}`,
  );

  if (fc.gate.verdict === "reject") {
    console.log(`  -> new draft itself rejected, leaving original untouched.`);
    return;
  }
  if (oldScore !== null && fc.gate.overallScore < oldScore) {
    console.log(`  -> new draft scores LOWER than the original (${fc.gate.overallScore.toFixed(1)} < ${oldScore.toFixed(1)}), leaving original untouched.`);
    return;
  }

  const existingBlocks = await prisma.articleBlock.findMany({ where: { articleId: article.id, type: "TEXT" } });
  await prisma.articleBlock.deleteMany({ where: { id: { in: existingBlocks.map((b) => b.id) } } });
  await prisma.articleBlock.createMany({
    data: result.paragraphs.map((text, position) => ({ articleId: article.id, type: "TEXT" as const, position, data: { text } })),
  });
  await prisma.article.update({
    where: { id: article.id },
    data: {
      headline: result.headline,
      subtitle: result.subtitle,
      keyTakeaway: result.keyTakeaway,
      ...fc.scores,
      updatedAt: new Date(),
    },
  });
  console.log(`  -> replaced with the regenerated draft.`);
}

async function main() {
  const limit = process.env.REGEN_LIMIT ? Number(process.env.REGEN_LIMIT) : undefined;
  const articles = await prisma.article.findMany({
    where: { status: "PUBLISHED", locale: "en", type: { in: ["NEWS", "BREAKING_NEWS"] } },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
      slug: true,
      headline: true,
      factualScore: true,
      sourceScore: true,
      qualityScore: true,
      originalityScore: true,
      valueScore: true,
      readabilityScore: true,
    },
  });
  console.log(`Regenerating ${articles.length} pipeline-written NEWS/BREAKING_NEWS article(s) with the new writer+fact-checker...\n`);
  for (const article of articles) {
    try {
      await regenerateOne(article);
    } catch (err) {
      console.error(`- "${article.headline}": unexpected failure —`, err instanceof Error ? err.message : err);
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
