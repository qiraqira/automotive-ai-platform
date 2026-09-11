import { prisma } from "@automotive/database";
import { env, budgetLimits } from "@automotive/config";
import { assertWithinBudget, recordExecution, handleBudgetExceeded, BudgetExceededError } from "@automotive/ai";

// AI vision gate for apps/worker/src/fetch-images.ts's free-stock search
// (Wikimedia Commons + Openverse) — user's explicit instruction: before
// accepting a candidate photo, have a vision model confirm it actually
// depicts the article's real subject, not just that its title/tags share
// words with the search query. Real gap this closes: the existing
// isRelevantTitle() text check in fetch-images.ts only catches word
// overlap, not topic — verified live that a "Labor Day Green Deals hub"
// article (no single car/brand to search for) matched and accepted a
// 19th-century Labor Day parade engraving from Commons, because "Labor"
// and "Day" both appear as whole words near the front of that file's
// real title. A word-overlap check can't see that the photo itself has
// nothing to do with cars; a vision model looking at the actual pixels
// can.
//
// Raw fetch() to OpenAI's chat completions endpoint, same posture as
// generate-image.ts (no SDK for one lightweight endpoint) and same
// budget-guard plumbing as every other real AI call in this codebase.

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const FETCH_TIMEOUT_MS = 20_000;
// Vision-capable, cheapest OpenAI chat model — this is a binary
// relevance check, not content generation, so the smallest capable model
// is the right cost/quality tradeoff (same reasoning that already picked
// gpt-image-1-mini over gpt-image-1 in generate-image.ts).
const MODEL = "gpt-4o-mini";
// Real, live failure found 2026-09-11 (user caught it live: a BYD
// Sealion 6 photo published as the hero image for a "BYD Denza N8"
// article): this same candidate photo was correctly rejected (NO) three
// separate times for a differently-worded context ("BYD's new
// Defender-like SUV breaks cover") but wrongly accepted (YES) once for
// a more generic one ("BYD's new luxury electric SUV has a range of
// over 1,000 km") — traced via the real AIJob log for both contexts
// before concluding this, not assumed. The "low" detail setting was the
// prime suspect: it fixes image input at a small, fixed token budget
// regardless of resolution, which is fine for "is this obviously
// unrelated" but not enough detail to distinguish two visually similar
// SUVs from the same brand family. Switched to "high" detail — a real,
// deliberate cost increase (roughly 10-20x the token count of "low" for
// a photo this size) accepted specifically because a wrong SPECIFIC-
// vehicle photo publishing live is a worse outcome than the extra
// fraction-of-a-cent this costs per check.
const IMAGE_DETAIL = "high";
// Verified live against OpenAI's current published rates before picking
// this (developers.openai.com/api/docs/pricing, 2026-09-10): gpt-4o-mini
// is $0.15/1M input tokens, $0.60/1M output tokens. "High" detail on a
// photo around 1024px scales to roughly 1500-1800 input tokens (OpenAI's
// own tiling formula), well under $0.001 either way — this estimate is
// deliberately generous for the pre-call budget guard, same margin as
// before.
const ESTIMATED_COST_USD = 0.004;

interface OpenAIChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

interface OpenAIChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: OpenAIChatUsage;
}

function realCostUsd(usage: OpenAIChatUsage | undefined): number {
  if (!usage) return 0;
  return (usage.prompt_tokens / 1_000_000) * 0.15 + (usage.completion_tokens / 1_000_000) * 0.6;
}

/** Asks a vision model whether `imageUrl` genuinely depicts `context`
 * (the article's real subject — headline/story title, ideally naming a
 * brand+model). Fails OPEN (returns true, i.e. "accept the candidate")
 * whenever the check itself can't run — no API key, budget exceeded, a
 * network/parse error — so this gate can only make image selection more
 * conservative, never regress fetch-images.ts's existing behavior back
 * toward "no image at all" when OpenAI is unavailable. The existing
 * isRelevantTitle() text check in fetch-images.ts still runs before this
 * and catches plenty on its own; this is an additional filter, not the
 * only one. */
export async function verifyImageMatch(imageUrl: string, context: string): Promise<boolean> {
  if (!env.OPENAI_API_KEY) return true;

  const job = await prisma.aIJob.create({
    // No dedicated AIJobType for this either — same reused-type reasoning
    // generate-image.ts already documents for its own OpenAI call.
    data: { type: "WRITE_ARTICLE", status: "RUNNING", input: { purpose: "verify_hero_image", imageUrl, context } },
  });

  try {
    await assertWithinBudget(ESTIMATED_COST_USD, budgetLimits);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      await handleBudgetExceeded(job.id, err);
      console.log(`Image verification budget guard blocked this call (${err.message}) — accepting candidate unverified.`);
      return true;
    }
    throw err;
  }

  const prompt = `You are a photo editor at an automotive news website, deciding whether a candidate stock photo is safe to publish as the hero image for this article.

Article subject: "${context}"

Does the photo genuinely depict this exact subject? If the subject names a specific model (e.g. "Denza N8", "Model Y", "F-150 Lightning"), the photo must show that exact model — a different, even closely related model from the same brand or lineup (a sibling model, a different generation, a similar-looking SUV from the same maker) is NOT a match and must be rejected, even if the general shape or class of vehicle looks similar. Only accept a same-brand-different-model photo if the subject itself is genuinely brand-level or generic (a roundup with no single car, a general company/industry story) rather than naming one specific vehicle. Reject anything unrelated that merely shares a word with the subject (e.g. a historical parade photo for a "Labor Day" business story, an unrelated landmark or object).

Answer with exactly one word: YES or NO.`;

  const start = Date.now();
  let response: OpenAIChatResponse;
  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl, detail: IMAGE_DETAIL } },
            ],
          },
        ],
        max_tokens: 5,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`OpenAI chat API returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    response = (await res.json()) as OpenAIChatResponse;
  } catch (err) {
    const latencyMs = Date.now() - start;
    await recordExecution({
      jobId: job.id,
      provider: "openai",
      model: MODEL,
      tokensIn: 0,
      tokensOut: 0,
      estimatedCostUsd: 0,
      latencyMs,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    await prisma.aIJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date() } });
    console.error(`Image verification failed for ${imageUrl} —`, err instanceof Error ? err.message : err, "— accepting candidate unverified.");
    return true;
  }
  const latencyMs = Date.now() - start;

  const answer = response.choices?.[0]?.message?.content?.trim().toUpperCase() ?? "";
  const matched = answer.startsWith("YES");
  const costUsd = realCostUsd(response.usage);
  await recordExecution({
    jobId: job.id,
    provider: "openai",
    model: MODEL,
    tokensIn: response.usage?.prompt_tokens ?? 0,
    tokensOut: response.usage?.completion_tokens ?? 0,
    estimatedCostUsd: costUsd,
    latencyMs,
    success: true,
  });
  await prisma.aIJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), result: { matched, answer } } });

  if (!matched) {
    console.log(`Image verification rejected a candidate for "${context}" (model answered "${answer}"): ${imageUrl}`);
  }
  return matched;
}
