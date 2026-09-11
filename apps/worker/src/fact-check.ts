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
//
// Upgraded 2026-09-12, user's own explicit request ("проверяем потом
// хорошей мощной моделью" — verify with a good, powerful model; "Каждый
// раз гугли" — search every time): before this, the "second opinion"
// was the exact same cheap model (Haiku 4.5) that wrote the draft in
// the first place, checking only against the same static source
// excerpts already in the prompt — real, but not an independent check.
// Now runs on Sonnet 5 with real web search enabled (verified working
// live before this was wired up — see the removed test-websearch-combo.ts
// commit) so a genuinely different, stronger model can catch a claim
// that's wrong even though it matches the sources (a stale spec, a
// renamed trim), not just a claim that contradicts them.
const FACT_CHECK_MODEL = "claude-sonnet-5";
// Lowered from 3 to 2, 2026-09-12: real data from the first full
// corpus audit (136 real calls) showed the model averages 1.55
// searches and used all 3 in only 6 cases (~4%) — the third search
// almost never changes anything, so this trims the worst-case cost
// ceiling and the token overhead of an extra search round-trip with
// negligible real effect on what the check actually catches.
const WEB_SEARCH_MAX_USES = 2;
// Verified against platform.claude.com/docs/en/about-claude/pricing
// before hardcoding: Sonnet 5 is $2/1M input tokens, $10/1M output —
// exactly 2x Haiku 4.5's own $1/$5 rate already used elsewhere in this
// codebase. Web search is billed separately, $10 per 1,000 real
// searches ($0.01 each), on top of the tokens a search result itself
// adds to the conversation.
const SONNET_INPUT_COST_PER_M = 2;
const SONNET_OUTPUT_COST_PER_M = 10;
const WEB_SEARCH_COST_PER_CALL = 0.01;

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

  // Pre-flight estimate, deliberately generous (same posture as every
  // other real budget guard in this codebase): Sonnet's own per-token
  // rate plus the worst case of every allowed web search actually
  // firing (WEB_SEARCH_MAX_USES x $0.01) — the real, final cost
  // recorded below is almost always lower than this ceiling.
  const estimatedCostUsd = 0.05 + WEB_SEARCH_MAX_USES * WEB_SEARCH_COST_PER_CALL;
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
  const prompt = `Draft article:\n${draftText}\n\nSource headlines/excerpts this was supposed to be based on (real ground truth from this platform's own ingestion — anything in the draft not traceable to these OR to a real, current web search result is a factual problem):\n${sourcesBlock}\n\nScore this draft honestly against its own sources. If a specific, checkable claim (a spec, a price, a trim name, a date) seems plausible but you aren't certain it's still current or correctly stated, use web search to verify it against a real, current source before scoring factualScore — don't guess either way.`;
  const system =
    "You are a skeptical, senior fact-checking editor for an automotive news platform, with real web search available. Your job is to catch a draft that invented, exaggerated, or misattributed anything relative to its sources, AND to catch a claim that's simply wrong or outdated even though it matches what the sources said (a renamed trim, a stale spec) — not to judge whether the story itself is interesting. Use web search when it would actually change your confidence in a specific claim; don't search reflexively for things the sources already settle. Score strictly: a well-written article built on an unsupported or now-incorrect claim must still score low on factualScore. Respond with JSON matching the given schema, and nothing else.";

  const provider = createTextProvider();
  const start = Date.now();
  let output: FactCheckOutput;
  try {
    const completion = await provider.complete({
      system,
      prompt,
      responseSchema: RESPONSE_SCHEMA,
      // Real bug found live 2026-09-12 (audit-published-quality.ts's
      // first real run): 1024 was sized for a plain text-only
      // completion, before web search was added. `max_tokens` caps
      // OUTPUT tokens, and every server_tool_use/web_search_tool_result
      // block Claude emits while searching counts against that same
      // cap before it ever reaches the final JSON answer — a real
      // multi-search fact-check hit `stop_reason: "max_tokens"` with
      // ZERO text blocks produced, which this provider correctly
      // surfaces as an error rather than silently returning nothing.
      // 4096 leaves real headroom for up to WEB_SEARCH_MAX_USES search
      // round-trips plus the actual scored response.
      maxTokens: 4096,
      model: FACT_CHECK_MODEL,
      webSearch: { maxUses: WEB_SEARCH_MAX_USES },
    });
    const latencyMs = Date.now() - start;
    output = JSON.parse(completion.text) as FactCheckOutput;

    const realCostUsd =
      (completion.tokensIn / 1_000_000) * SONNET_INPUT_COST_PER_M +
      (completion.tokensOut / 1_000_000) * SONNET_OUTPUT_COST_PER_M +
      (completion.webSearchCount ?? 0) * WEB_SEARCH_COST_PER_CALL;
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
    if (completion.webSearchCount) {
      console.log(`Article ${articleId}: fact-check performed ${completion.webSearchCount} real web search(es).`);
    }
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
