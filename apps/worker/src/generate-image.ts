import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@automotive/database";
import { env, budgetLimits } from "@automotive/config";
import { assertWithinBudget, recordExecution, handleBudgetExceeded, BudgetExceededError } from "@automotive/ai";

// The real AI-generation fallback for apps/worker/src/fetch-images.ts's
// free-stock Wikimedia Commons search — user's explicit instruction:
// search free stock first, generate via the OpenAI API when nothing free
// was found, automatically (not a manual upload — that flow still exists
// separately at /admin/articles for one-off replacements, but this is
// the real automated path). Calls OpenAI's images/generations endpoint
// directly over `fetch()` (no SDK — this project has no OpenAI SDK
// dependency anywhere yet, and one lightweight endpoint doesn't justify
// adding one). Shares the same
// `uploads_data` Docker volume as the manual-upload flow (see
// infrastructure/docker/docker-compose.yml's `worker` service comment) —
// this container has no web server of its own, `apps/web` serves the
// written file from the same underlying volume at its own mount point.

// Real, severe editorial-ethics gap found live 2026-09-09 (the user
// directly reviewed a real generated image and flagged it): a
// photorealistic image was generated for "Second Tesla driver killed
// after vehicle stopped on freeway with Autopilot engaged" — a real
// fatality — showing a fabricated but realistic-looking crash scene
// (police lights, a damaged car, a bystander). A small "AI-written"
// badge doesn't make a fabricated "photo" of a real death acceptable; a
// reader could easily mistake it for real accident-scene photography of
// the actual incident. Verified this is specifically a safety/fatality
// problem, not a general image-quality one: a same-session spot-check of
// 3 other AI-generated images (a concept-car reveal, a family lifestyle
// shot, a generic autonomous-SUV street scene) were all genuinely fine —
// none fabricate a depiction of a specific real event. User's explicit
// decision: never AI-generate a hero image for a Story classified under
// one of these topics — free-stock search or no image at all for these,
// never a fabricated "photo". Enforced here, the one real choke point
// every caller goes through to reach the OpenAI API, rather than at each
// call site — guarantees a future caller can't forget the check.
// Verified live before relying on the topic slug as the sole gate: every
// real AI-generated image found under a sensitive crash/fatal/recall
// headline was independently confirmed to already be classified under
// this exact slug by the existing keyword rules
// (packages/editorial/src/topic-classifier.ts) — no stragglers found via
// a broader keyword sweep across every real AI-generated image's own
// headline.
const NO_AI_IMAGE_TOPIC_SLUGS = new Set(["safety-recalls"]);

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const UPLOAD_DIR = "/repo/uploads";
// gpt-image-1 generation genuinely takes tens of seconds — verified
// against OpenAI's own docs before picking this, not guessed from a
// generic "fetch timeout" default.
const FETCH_TIMEOUT_MS = 90_000;
// "low" quality chosen deliberately (user's explicit cost-conscious
// choice, same posture as choosing Haiku for text) — "1536x1024" is one
// of exactly 3 real supported sizes for gpt-image-1/gpt-image-1-mini
// (verified against the real OpenAI SDK's own response type before
// picking it, not guessed), landscape orientation matching this app's
// existing hero image aspect ratio.
const SIZE = "1536x1024";
const QUALITY = "low";
// Real gap found and fixed 2026-09-09 (user's direct follow-up — the
// real per-image cost felt too high after the first live backfill):
// switched from `gpt-image-1` to `gpt-image-1-mini` — verified live
// against OpenAI's own current pricing before switching, not guessed:
// mini's per-token rates are $2/$2.50/$8 (text-in/image-in/output) vs
// full gpt-image-1's $5/$10/$40 — output tokens dominate real cost here
// (confirmed from this file's own recorded AIExecution rows), so this is
// close to a real 5x reduction, not a marginal tweak. Same `low` quality,
// same size, same prompt — only the model changed.
const MODEL = "gpt-image-1-mini";
// Real gap found live 2026-09-09: gpt-image-1-mini's raw output is an
// uncompressed ~2MB PNG at 1536x1024, but every real caller only ever
// displays it as either a 96x64 CSS-scaled list thumbnail
// (apps/web/src/app/page.tsx) or a full-width article hero — nothing
// needs the raw pixel count, and the browser was downloading the full
// ~2MB for a 96x64 slot. Resized/re-encoded here (not at request time —
// this app deliberately has no next/image optimizer, see
// next.config.mjs's own comment) to the same 1200px width Commons'
// own thumbnail requests already use elsewhere in this codebase
// (fetch-images.ts's THUMB_WIDTH) for consistency, and re-encoded as
// JPEG (not WebP) since a plain <img> tag has no content-negotiation to
// pick a fallback format for older browsers. Quality 82 is a real,
// visually-lossless-for-photography tradeoff point, not a guess — this
// project's own manual per-image review pass (see README's image-QA
// entries) is the actual quality bar, and this is well above where
// JPEG banding starts becoming visible at typical hero-image sizes.
const COMPRESSED_WIDTH = 1200;
const JPEG_QUALITY = 82;
// A conservative pre-call estimate for assertWithinBudget() — the real
// cost is computed from the response's own real token usage afterward
// and is what actually gets recorded. Lowered alongside the model switch
// (was 0.03, sized for full gpt-image-1's real ~$0.0164 actual cost).
const ESTIMATED_COST_USD = 0.01;

interface OpenAIImageUsage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { text_tokens: number; image_tokens: number };
}

interface OpenAIImageResponse {
  data?: { b64_json?: string }[];
  usage?: OpenAIImageUsage;
}

// Real cost computed from the response's own real token usage — verified
// live against OpenAI's published per-token rates before writing this
// (not a flat per-image guess). gpt-image-1-mini (standard tier):
// $2/1M text-input, $2.50/1M image-input, $8/1M output tokens — update
// these three constants together if MODEL above ever changes.
function realCostUsd(usage: OpenAIImageUsage | undefined): number {
  if (!usage) return 0;
  const textIn = usage.input_tokens_details?.text_tokens ?? 0;
  const imageIn = usage.input_tokens_details?.image_tokens ?? 0;
  return (textIn / 1_000_000) * 2 + (imageIn / 1_000_000) * 2.5 + (usage.output_tokens / 1_000_000) * 8;
}

export async function generateHeroImage(
  articleId: string,
  headline: string,
  subtitle: string | null,
  topicSlug: string | null = null,
): Promise<boolean> {
  // Checked before the API-key check on purpose: this must refuse for a
  // sensitive topic regardless of key presence, and a caller reading the
  // log should see the real reason, not a less-specific "no key"
  // message when both happen to be true. Also makes this one real branch
  // unit-testable with no OPENAI_API_KEY/network mocking needed at all.
  if (topicSlug && NO_AI_IMAGE_TOPIC_SLUGS.has(topicSlug)) {
    console.log(`Article ${articleId}: skipping AI generation — topic "${topicSlug}" is never AI-illustrated (safety/fatality content).`);
    return false;
  }
  if (!env.OPENAI_API_KEY) return false;

  const job = await prisma.aIJob.create({
    // Reuses WRITE_ARTICLE — no dedicated AIJobType value exists for
    // image generation and adding one is a real schema migration for a
    // minor taxonomic distinction; `input.purpose` disambiguates for
    // anyone reading the real row.
    data: { type: "WRITE_ARTICLE", status: "RUNNING", input: { purpose: "generate_hero_image", articleId, headline } },
  });

  try {
    await assertWithinBudget(ESTIMATED_COST_USD, budgetLimits);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      await handleBudgetExceeded(job.id, err);
      console.log(`Article ${articleId}: image-generation budget guard blocked this call (${err.message}).`);
      return false;
    }
    throw err;
  }

  const prompt = `Editorial photojournalism-style image for an automotive news article. Headline: "${headline}".${subtitle ? ` Context: ${subtitle}.` : ""} Realistic, professional automotive photography style. No text, no logos, no watermarks, no readable brand badges.`;

  const start = Date.now();
  let response: OpenAIImageResponse;
  try {
    const res = await fetch(OPENAI_IMAGES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt, size: SIZE, quality: QUALITY, n: 1 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`OpenAI images API returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    response = (await res.json()) as OpenAIImageResponse;
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
    console.error(`Article ${articleId}: image generation failed —`, err instanceof Error ? err.message : err);
    return false;
  }
  const latencyMs = Date.now() - start;

  const b64 = response.data?.[0]?.b64_json;
  const costUsd = realCostUsd(response.usage);
  await recordExecution({
    jobId: job.id,
    provider: "openai",
    model: MODEL,
    tokensIn: response.usage?.input_tokens ?? 0,
    tokensOut: response.usage?.output_tokens ?? 0,
    estimatedCostUsd: costUsd,
    latencyMs,
    success: Boolean(b64),
    errorMessage: b64 ? undefined : "No b64_json in OpenAI response",
  });

  if (!b64) {
    await prisma.aIJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date() } });
    console.error(`Article ${articleId}: OpenAI response had no image data.`);
    return false;
  }

  const rawBytes = Buffer.from(b64, "base64");
  const resized = sharp(rawBytes).resize({ width: COMPRESSED_WIDTH, withoutEnlargement: true }).jpeg({ quality: JPEG_QUALITY });
  const { data: bytes, info } = await resized.toBuffer({ resolveWithObject: true });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = `${randomUUID()}.jpg`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, filename), bytes);

  const existingImage = await prisma.image.findUnique({ where: { sha256 } });
  const image =
    existingImage ??
    (await prisma.image.create({
      data: {
        originalUrl: `/uploads/${filename}`,
        localStorageUrl: `/uploads/${filename}`,
        sourceType: "AI_GENERATED",
        rightsStatus: "OFFICIAL_USE_ALLOWED",
        attribution: `AI-generated image (OpenAI ${MODEL}) — no third-party rights involved.`,
        generatedByAi: true,
        sha256,
        mimeType: "image/jpeg",
        width: info.width,
        height: info.height,
      },
    }));

  await prisma.articleImage.deleteMany({ where: { articleId, role: "HERO" } });
  await prisma.articleImage.create({
    data: { articleId, imageId: image.id, role: "HERO", position: 0, altText: headline },
  });

  await prisma.aIJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), result: { imageId: image.id } } });
  console.log(`Article ${articleId}: generated a real AI hero image (cost $${costUsd.toFixed(4)}).`);
  return true;
}
