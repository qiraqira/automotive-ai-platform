import { prisma } from "@automotive/database";
import { budgetLimits } from "@automotive/config";
import { assertWithinBudget, recordExecution, handleBudgetExceeded, BudgetExceededError, createTextProvider } from "@automotive/ai";
import { evaluateQualityGate, type QualityScores, type QualityGateResult, type QualityGateThresholds } from "@automotive/editorial";

// Real gap closed 2026-09-09, user's explicit request ("реальная проверка
// фактов"): packages/editorial/src/quality-gate.ts's evaluateQualityGate()
// has existed since 2026-09-08 (spec §36, unit-tested, configurable
// thresholds) but had zero real caller — nothing in this codebase ever
// computed the 6 scores it needs, so AUTO_MODERATION (packages/config)
// stayed permanently off and every article auto-published on nothing more
// than the Writer's own zero-shot instruction not to fabricate facts.
// This is the second AI pass that actually produces those scores: a real
// Claude call that re-reads the drafted article against the same source
// excerpts the Writer saw, specifically checking whether it stayed within
// them. Same three-function chain as every other real AI call in this
// codebase (assertWithinBudget -> provider.complete -> recordExecution),
// same "reuses an existing AIJobType" posture as generate-image.ts, except
// this one has a real dedicated type (QUALITY_CHECK) already in the
// schema rather than needing to borrow WRITE_ARTICLE's.

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    qualityScore: { type: "number", description: "0-100. Overall writing quality: clarity, structure, professionalism." },
    originalityScore: { type: "number", description: "0-100. How much this is a genuine synthesis rather than a close paraphrase of one source's wording or structure." },
    factualScore: {
      type: "number",
      description:
        "0-100. The most important score. 100 means every factual claim (spec, price, date, quote, name) in the article is directly supported by the provided sources. Deduct heavily for any claim not traceable to a source, even a plausible-sounding one.",
    },
    sourceScore: { type: "number", description: "0-100. Strength of the sourcing itself: number and quality of independent sources, not the article's fidelity to them." },
    valueScore: { type: "number", description: "0-100. Whether a reader learns something real and specific, versus generic filler." },
    readabilityScore: { type: "number", description: "0-100. Clarity and flow for a general reader." },
    concerns: { type: "string", description: "One or two sentences on the single biggest weakness found, or \"None\" if genuinely none." },
  },
  required: ["qualityScore", "originalityScore", "factualScore", "sourceScore", "valueScore", "readabilityScore", "concerns"],
  additionalProperties: false,
};

interface FactCheckOutput extends QualityScores {
  concerns: string;
}

export interface FactCheckResult {
  scores: QualityScores;
  gate: QualityGateResult;
  concerns: string;
}

/** Runs the real Fact Checker / Quality Gate pass (spec §36) against an
 * already-drafted article. Returns null (never blocks the caller) if the
 * budget guard blocks the call — the caller decides what "no result"
 * means for its own publish/review/reject logic, this function only ever
 * reports what it found. */
export async function factCheckArticle(
  articleId: string,
  headline: string,
  subtitle: string | null,
  paragraphs: string[],
  sourcesBlock: string,
  thresholds: QualityGateThresholds,
): Promise<FactCheckResult | null> {
  const job = await prisma.aIJob.create({
    data: { type: "QUALITY_CHECK", status: "RUNNING", input: { purpose: "fact_check", articleId, headline } },
  });

  const estimatedCostUsd = 0.01;
  try {
    await assertWithinBudget(estimatedCostUsd, budgetLimits);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      await handleBudgetExceeded(job.id, err);
      console.log(`Article ${articleId}: fact-check budget guard blocked this call (${err.message}).`);
      return null;
    }
    throw err;
  }

  const draftText = `Headline: ${headline}\n${subtitle ? `Subtitle: ${subtitle}\n` : ""}\n${paragraphs.join("\n\n")}`;
  const prompt = `Draft article:\n${draftText}\n\nSource headlines/excerpts this was supposed to be based on (this is the ONLY ground truth — anything in the draft not traceable to these is a factual problem):\n${sourcesBlock}\n\nScore this draft honestly against its own sources.`;
  const system =
    "You are a skeptical fact-checking editor for an automotive news platform. Your job is to catch a draft that invented, exaggerated, or misattributed anything relative to its sources — not to judge whether the story itself is interesting. Score strictly: a well-written article built on an unsupported claim must still score low on factualScore. Respond with JSON matching the given schema, and nothing else.";

  const provider = createTextProvider();
  const start = Date.now();
  let output: FactCheckOutput;
  try {
    const completion = await provider.complete({ system, prompt, responseSchema: RESPONSE_SCHEMA, maxTokens: 1024 });
    const latencyMs = Date.now() - start;
    output = JSON.parse(completion.text) as FactCheckOutput;

    const realCostUsd = (completion.tokensIn / 1_000_000) * 1 + (completion.tokensOut / 1_000_000) * 5;
    await recordExecution({
      jobId: job.id,
      provider: provider.name,
      model: completion.model,
      tokensIn: completion.tokensIn,
      tokensOut: completion.tokensOut,
      estimatedCostUsd: realCostUsd,
      latencyMs,
      success: true,
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    await recordExecution({
      jobId: job.id,
      provider: provider.name,
      model: "unknown",
      tokensIn: 0,
      tokensOut: 0,
      estimatedCostUsd: 0,
      latencyMs,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    await prisma.aIJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date() } });
    console.error(`Article ${articleId}: fact-check failed —`, err);
    return null;
  }

  const scores: QualityScores = {
    qualityScore: output.qualityScore,
    originalityScore: output.originalityScore,
    factualScore: output.factualScore,
    sourceScore: output.sourceScore,
    valueScore: output.valueScore,
    readabilityScore: output.readabilityScore,
  };
  const gate = evaluateQualityGate(scores, thresholds);

  await prisma.aIJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), result: { verdict: gate.verdict, overallScore: gate.overallScore, concerns: output.concerns } } });
  console.log(`Article ${articleId}: fact-check verdict "${gate.verdict}" (score ${gate.overallScore.toFixed(1)}) — ${gate.reason}`);

  return { scores, gate, concerns: output.concerns };
}
