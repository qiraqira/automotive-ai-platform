import { prisma } from "@automotive/database";
import { env, budgetLimits, featureFlags, qualityGateThresholds } from "@automotive/config";
import { assertWithinBudget, recordExecution, handleBudgetExceeded, BudgetExceededError, createTextProvider } from "@automotive/ai";
import { decideComposition, countIndependentOrigins } from "@automotive/editorial";
import { attachHeroImage } from "./fetch-images.js";
import { generateHeroImage } from "./generate-image.js";
import { factCheckArticle } from "./fact-check.js";
import { cosineSimilarity } from "./embed.js";

// Real gap closed 2026-09-09, user's explicit request: packages/editorial/
// src/source-independence.ts's countIndependentOrigins()/
// groupByInformationOrigin() have existed since 2026-09-08, fully unit-
// tested, but had zero real caller — checked why before wiring it, not
// just assumed a missing import: that module groups by `originUrl`, "the
// primary source... this article cites/republishes" — a field that does
// not exist anywhere on the real `SourceArticle` schema and nothing ever
// detects. Calling it as-is on real data would be theater: every article
// would fall back to its own `id` (that function's own `?? article.id`),
// making `countIndependentOrigins()` mathematically identical to
// `articles.length` — technically "wired", contributing zero real signal.
// This computes a REAL, if approximate, origin key instead: SourceArticle.
// embedding (apps/worker/src/embed.ts) already exists per-article at zero
// extra cost (populated at ingest time for the duplicate-detection
// feature) — outlets that are really just re-reporting the same press
// release/wire copy tend to produce near-identical headlines (very high
// cosine similarity), while independently-reported coverage of the same
// event diverges more. A conservative, high threshold (0.92 — well above
// the ~0.78 seen for two independently-written headlines about the same
// real event, see embed.ts's own verified data point) errs toward NOT
// collapsing origins rather than over-collapsing, matching this
// codebase's established "a missed signal beats a wrong one" posture.
// Falls back to treating every article as its own independent origin for
// any SourceArticle predating the embedding feature (`embedding: []`) —
// cosineSimilarity() already returns 0 for an empty vector, so this is
// automatic, not a special case.
const ORIGIN_SIMILARITY_THRESHOLD = 0.92;

function countIndependentOriginsByEmbedding(articles: { id: string; embedding: number[] }[]): number {
  const representatives: { id: string; embedding: number[] }[] = [];
  const withOrigin = articles.map((a) => {
    const match = representatives.find((r) => cosineSimilarity(r.embedding, a.embedding) > ORIGIN_SIMILARITY_THRESHOLD);
    if (match) return { id: a.id, originUrl: match.id };
    representatives.push(a);
    return { id: a.id, originUrl: null };
  });
  return countIndependentOrigins(withOrigin);
}

// The first real Writer stage (docs/ai-pipeline.md's 9-stage design) —
// takes an already-clustered, already-ingested Story (apps/worker/src/
// ingest.ts) and produces a real, original AI-written Article. Everything
// upstream of this (Researcher, Fact Extractor, Fact Checker) is still
// design-only (see docs/ai-pipeline.md's own corrected top note) — this
// writes directly from the Story's title/summary and its SourceArticles'
// short excerpts, which is an honest simplification: no independent
// research, no formal fact-checking pass yet. Deliberately instructed to
// write ORIGINAL synthesis, never to reproduce a source excerpt near-
// verbatim — matches docs/security.md's "no full-text mirroring"
// principle, which is exactly why SourceArticle.excerpt is short in the
// first place.
//
// One-shot CLI entrypoint (`npm run write:articles --workspace
// @automotive/worker`), same shape as backfill-topics.ts. Batch size and
// spend are both bounded on purpose: WRITE_ARTICLE_BATCH_SIZE (default 5)
// caps how many real Stories one run touches, and every single call still
// goes through the real assertWithinBudget()/AI_DAILY_BUDGET_USD guard
// per story — a run doesn't stop being safe just because the batch is
// small.

const DEFAULT_BATCH_SIZE = Number(process.env.WRITE_ARTICLE_BATCH_SIZE ?? 5);

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "A concise, factual news headline, under 100 characters." },
    subtitle: { type: "string", description: "One sentence expanding on the headline." },
    keyTakeaway: { type: "string", description: "The single most important fact, in one sentence." },
    paragraphs: {
      type: "array",
      items: { type: "string" },
      // The Anthropic structured-output schema only accepts `minItems`/
      // `maxItems` of 0 or 1 for an array (confirmed live via a real 400:
      // "For 'array' type, 'minItems' values other than 0 or 1 are not
      // supported") — the desired 3-6 range is expressed in the
      // description text instead, which the model reliably follows.
      description: "The article body, as exactly 3 to 6 original paragraphs of plain prose (no markdown).",
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function writeOne(story: {
  id: string;
  title: string;
  summary: string | null;
  primaryTopic: { slug: string } | null;
  sourceArticles: { id: string; title: string; url: string; excerpt: string | null; embedding: number[]; source: { name: string } }[];
}): Promise<void> {
  const job = await prisma.aIJob.create({
    data: { type: "WRITE_ARTICLE", status: "RUNNING", storyId: story.id, input: { storyTitle: story.title } },
  });

  const sourcesBlock = story.sourceArticles
    .map((a, i) => `${i + 1}. [${a.source.name}] "${a.title}"${a.excerpt ? ` — ${a.excerpt}` : ""}`)
    .join("\n");
  const independentOriginCount = countIndependentOriginsByEmbedding(story.sourceArticles);

  const prompt = `Story title: ${story.title}
${story.summary ? `Known summary: ${story.summary}\n` : ""}
Source headlines/excerpts (for factual grounding only — do not copy any sentence verbatim, do not fabricate facts beyond what's stated here):
${sourcesBlock}

Write a short, original automotive-news article synthesizing the above.`;

  const system =
    "You are a factual automotive news writer for an editorial platform whose core rule is: never reproduce a source's wording, only synthesize the facts into original prose. Stay strictly within the facts given — never invent a spec, date, price, or quote that isn't stated in the sources. Neutral, concise, journalistic tone. Respond with JSON matching the given schema, and nothing else.";

  const estimatedCostUsd = 0.01;
  try {
    await assertWithinBudget(estimatedCostUsd, budgetLimits);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      await handleBudgetExceeded(job.id, err);
      console.log(`Story ${story.id}: budget guard blocked this write (${err.message}).`);
      return;
    }
    throw err;
  }

  const provider = createTextProvider();
  const start = Date.now();
  let result: WriterOutput;
  try {
    if (process.env.WRITE_ARTICLE_DEBUG_SCHEMA) console.error("DEBUG RESPONSE_SCHEMA:", JSON.stringify(RESPONSE_SCHEMA));
    const completion = await provider.complete({ system, prompt, responseSchema: RESPONSE_SCHEMA, maxTokens: 2048 });
    const latencyMs = Date.now() - start;
    result = JSON.parse(completion.text) as WriterOutput;

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
    console.error(`Story ${story.id}: write failed —`, err);
    return;
  }

  const slug = `${slugify(result.headline)}-${story.id.slice(-6)}`;

  // Real gap found and fixed 2026-09-08: this used to hardcode
  // `status: "PUBLISHED"` regardless of `AUTO_PUBLISH` — a real,
  // documented contradiction with this project's own stated principle
  // ("AI assisted, not autonomous", enforced elsewhere by the `ai_agent`
  // Role deliberately lacking `PUBLISH_ARTICLE` — see
  // packages/database/src/bootstrap.ts) and with `.env.example`'s own
  // "all default OFF until proven safe" framing for every AUTO_* flag.
  // `AUTO_PUBLISH=false` (the real default) now lands a real `DRAFT`
  // Article instead — reviewable/publishable by a human with
  // `PUBLISH_ARTICLE` via `GET/PATCH /v1/admin/articles`, not silently
  // invisible. Only `AUTO_PUBLISH=true` (an explicit, deliberate opt-in)
  // reproduces the previous auto-publish behavior.
  const autoPublish = featureFlags.autoPublish;

  // Real gap closed 2026-09-09, user's explicit request: always lands as
  // DRAFT first — the real final status (below) now depends on the
  // Fact Checker/Quality Gate verdict when AUTO_MODERATION is on, not
  // only on AUTO_PUBLISH, so the create and the status decision are two
  // separate steps instead of one ternary baked into the insert.
  const article = await prisma.article.create({
    data: {
      storyId: story.id,
      locale: "en",
      type: "NEWS",
      contentPurpose: "BACKGROUND",
      status: "DRAFT",
      slug,
      headline: result.headline,
      subtitle: result.subtitle,
      keyTakeaway: result.keyTakeaway,
      authorType: "AI_AGENT",
      blocks: {
        create: result.paragraphs.map((text, position) => ({ type: "TEXT" as const, position, data: { text } })),
      },
    },
  });

  await prisma.aIJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), result: { articleId: article.id, slug } } });

  // Real gap found and fixed 2026-09-09, user's explicit request (they
  // directly noticed real published articles with no visible source
  // link): the `Citation` model has existed since the initial schema
  // scaffold, with real `sourceArticleId`/`url`/`label` fields exactly
  // for this — but nothing anywhere in this file ever created one.
  // Confirmed live before fixing: all 142 real published Articles at the
  // time had ZERO Citation rows, and the article page itself never
  // rendered any (see apps/web's article page + this row's own fix
  // there). Not a per-article parsing failure — a wholly unbuilt
  // feature. Creates one real Citation per real `SourceArticle` already
  // fetched into `story.sourceArticles` above (the exact same rows the
  // prompt was built from, real `url`/`title` already on hand) — zero
  // extra AI cost, zero fabrication.
  await prisma.citation.createMany({
    data: story.sourceArticles.map((a) => ({
      articleId: article.id,
      sourceArticleId: a.id,
      label: `${a.source.name}: ${a.title}`,
      url: a.url,
    })),
  });

  // Real Fact Checker / Quality Gate pass (spec §36, apps/worker/src/
  // fact-check.ts) — the second AI call that actually scores the draft
  // against its own sources, closing the "auto-publish on nothing but the
  // Writer's own zero-shot promise" gap. A "reject"/"review" verdict
  // overrides AUTO_PUBLISH (moderation catching a problem always wins);
  // a "publish" verdict still respects AUTO_PUBLISH as a separate,
  // independent gate — passing the quality bar doesn't itself grant
  // publish permission, same layered-flag posture as every other AUTO_*
  // flag in this codebase. A blocked/failed fact-check (fc === null)
  // falls back to the AUTO_PUBLISH-only decision rather than blocking the
  // pipeline on a moderation failure.
  let finalStatus: "PUBLISHED" | "DRAFT" | "REJECTED" = autoPublish ? "PUBLISHED" : "DRAFT";
  let scoreFields: Record<string, number> = {};
  let moderationNote = autoPublish ? "AUTO_PUBLISH is on" : "AUTO_PUBLISH is off";

  if (featureFlags.autoModeration) {
    // Real gap closed 2026-09-09 (see countIndependentOriginsByEmbedding()'s
    // own top comment): tells the Fact Checker how many of the sources
    // above are genuinely independent, not just how many are listed — so
    // its sourceScore judgment isn't fooled by 5 outlets that all just
    // reworded the same wire copy into looking like strong corroboration.
    const sourcesBlockWithIndependence = `${sourcesBlock}\n\n(${independentOriginCount} of the above ${story.sourceArticles.length} source(s) appear to be genuinely independent reporting, not re-reports of the same original piece — judge sourceScore accordingly.)`;
    const fc = await factCheckArticle(article.id, result.headline, result.subtitle, result.paragraphs, sourcesBlockWithIndependence, qualityGateThresholds);
    if (fc) {
      scoreFields = { ...fc.scores };
      if (fc.gate.verdict === "reject") {
        finalStatus = "REJECTED";
        moderationNote = `rejected by quality gate (score ${fc.gate.overallScore.toFixed(1)}): ${fc.concerns}`;
      } else if (fc.gate.verdict === "review") {
        finalStatus = "DRAFT";
        moderationNote = `held for human review by quality gate (score ${fc.gate.overallScore.toFixed(1)}): ${fc.concerns}`;
      } else {
        moderationNote = `passed quality gate (score ${fc.gate.overallScore.toFixed(1)}), ${moderationNote}`;
      }
    }
  }

  // Defense in depth, same day as the Citation fix above: never let an
  // Article reach PUBLISHED with zero real Citation rows, regardless of
  // how this function's control flow changes in the future — the
  // createMany() above should always have populated at least one (every
  // candidate Story is queried with `sourceArticles: { some: {} } }`),
  // but this is a hard invariant worth enforcing here directly rather
  // than trusting that upstream guarantee alone, same "fail loud, never
  // silently insecure" posture as this codebase's other real invariants
  // (AUTH_JWT_SECRET, the seed script's NODE_ENV guard, etc.).
  if (finalStatus === "PUBLISHED") {
    const citationCount = await prisma.citation.count({ where: { articleId: article.id } });
    if (citationCount === 0) {
      finalStatus = "DRAFT";
      moderationNote = `held back: zero real Citation rows exist, refusing to publish without real sources (${moderationNote})`;
    }
  }

  await prisma.article.update({
    where: { id: article.id },
    data: { status: finalStatus, publishedAt: finalStatus === "PUBLISHED" ? new Date() : null, ...scoreFields },
  });

  console.log(
    finalStatus === "PUBLISHED"
      ? `Story ${story.id}: published article "${result.headline}" (/articles/en/${slug}) — ${moderationNote}`
      : `Story ${story.id}: ${finalStatus === "REJECTED" ? "rejected" : "drafted"} article "${result.headline}" — ${moderationNote}`,
  );

  // No point sourcing/generating a hero image for an article that was
  // just rejected — real free-stock search (Wikimedia Commons — see
  // fetch-images.ts) first per the user's explicit instruction, AI-
  // generated fallback (generate-image.ts) only when free stock finds
  // nothing, for anything that made it past the gate above. Neither step
  // ever blocks the article itself — both are logged either way, not
  // silently swallowed.
  if (finalStatus === "REJECTED") return;
  try {
    const foundFree = await attachHeroImage(article.id, [story.title, result.headline]);
    if (foundFree) {
      console.log(`Story ${story.id}: attached a real free-stock hero image.`);
    } else {
      const generated = await generateHeroImage(article.id, result.headline, result.subtitle, story.primaryTopic?.slug ?? null);
      console.log(generated ? `Story ${story.id}: generated a real AI hero image.` : `Story ${story.id}: no free-stock image found and AI generation unavailable/skipped/failed.`);
    }
  } catch (err) {
    console.error(`Story ${story.id}: hero image search failed —`, err instanceof Error ? err.message : err);
  }
}

const UPDATE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    paragraph: {
      type: "string",
      description: "One or two new paragraphs of plain prose (no markdown) covering ONLY what's new — do not restate anything from the existing article.",
    },
  },
  required: ["paragraph"],
  additionalProperties: false,
};

interface UpdateOutput {
  paragraph: string;
}

// Real gap closed 2026-09-09, user's explicit request: packages/editorial/
// src/composition.ts's decideComposition() (CREATE/UPDATE/MERGE/SPLIT/
// REJECT) has existed since 2026-09-08, fully unit-tested, but had zero
// real caller — structurally so, not just an oversight: runWriteArticleBatch()'s
// only candidate query (`articles: { none: { locale: "en" } }`) excludes
// every Story that already has an article, so there was never a candidate
// for which UPDATE/MERGE/REJECT could even be considered; every real
// Story only ever went through CREATE. This is the real second path:
// Stories that already have an EN article but have gathered genuinely new
// coverage since (see runWriteArticleBatch()'s own second query below) —
// writes ONLY the new material as an appended block, records a real
// ArticleRevision (packages/database/prisma/schema.prisma — existed since
// the schema scaffold, also never written to before this, see /about/
// corrections's own honesty fix earlier the same day), and still runs
// the new material through the real Fact Checker/Quality Gate
// (fact-check.ts) before touching an article that may already be live —
// a "reject" verdict here means don't touch it, not "unpublish it".
async function updateOne(
  story: { id: string; primaryTopic: { slug: string } | null },
  article: { id: string; headline: string; existingParagraphs: string[]; nextPosition: number },
  newSourceArticles: { id: string; title: string; url: string; excerpt: string | null; source: { name: string } }[],
): Promise<void> {
  const job = await prisma.aIJob.create({
    data: { type: "WRITE_ARTICLE", status: "RUNNING", storyId: story.id, input: { purpose: "update_article", articleId: article.id } },
  });

  const sourcesBlock = newSourceArticles.map((a, i) => `${i + 1}. [${a.source.name}] "${a.title}"${a.excerpt ? ` — ${a.excerpt}` : ""}`).join("\n");
  const prompt = `Existing article headline: ${article.headline}\n\nExisting article text (do not repeat any of this):\n${article.existingParagraphs.join("\n\n")}\n\nGenuinely new source coverage since this article was written:\n${sourcesBlock}\n\nWrite a short update covering ONLY what's new.`;
  const system =
    "You are a factual automotive news editor writing an update to an already-published article. Your only job is the new information — never restate what the article already says. Stay strictly within the new sources given; never invent a spec, date, price, or quote. Neutral, concise, journalistic tone. Respond with JSON matching the given schema, and nothing else.";

  const estimatedCostUsd = 0.01;
  try {
    await assertWithinBudget(estimatedCostUsd, budgetLimits);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      await handleBudgetExceeded(job.id, err);
      console.log(`Article ${article.id}: budget guard blocked this update (${err.message}).`);
      return;
    }
    throw err;
  }

  const provider = createTextProvider();
  const start = Date.now();
  let result: UpdateOutput;
  try {
    const completion = await provider.complete({ system, prompt, responseSchema: UPDATE_RESPONSE_SCHEMA, maxTokens: 1024 });
    const latencyMs = Date.now() - start;
    result = JSON.parse(completion.text) as UpdateOutput;

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
    await recordExecution({ jobId: job.id, provider: provider.name, model: "unknown", tokensIn: 0, tokensOut: 0, estimatedCostUsd: 0, latencyMs, success: false, errorMessage: err instanceof Error ? err.message : String(err) });
    await prisma.aIJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date() } });
    console.error(`Article ${article.id}: update write failed —`, err);
    return;
  }

  await prisma.aIJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), result: { articleId: article.id } } });

  let shouldAppend = true;
  let gateNote = "AUTO_MODERATION is off";
  if (featureFlags.autoModeration) {
    const fc = await factCheckArticle(article.id, article.headline, null, [result.paragraph], sourcesBlock, qualityGateThresholds);
    if (fc) {
      gateNote = `quality gate verdict "${fc.gate.verdict}" (score ${fc.gate.overallScore.toFixed(1)})`;
      shouldAppend = fc.gate.verdict !== "reject";
    }
  }

  if (!shouldAppend) {
    console.log(`Article ${article.id}: update rejected by quality gate, not appended — ${gateNote}`);
    return;
  }

  await prisma.articleBlock.create({
    data: { articleId: article.id, type: "TEXT", position: article.nextPosition, data: { text: result.paragraph } },
  });
  // Same real-Citation fix as writeOne() above, for the update path.
  await prisma.citation.createMany({
    data: newSourceArticles.map((a) => ({
      articleId: article.id,
      sourceArticleId: a.id,
      label: `${a.source.name}: ${a.title}`,
      url: a.url,
    })),
  });
  await prisma.articleRevision.create({
    data: {
      articleId: article.id,
      authorType: "AI_AGENT",
      changeType: "update",
      diff: { addedParagraph: result.paragraph, newSourceCount: newSourceArticles.length },
      reason: `New coverage from ${newSourceArticles.length} additional source(s) — ${gateNote}`,
    },
  });
  // Bumps Article.updatedAt (schema `@updatedAt`) — the real signal
  // apps/web/src/app/sitemap.ts's lastmod already uses, so this update is
  // now real freshness signal for search engines too, not just a DB write.
  await prisma.article.update({ where: { id: article.id }, data: { updatedAt: new Date() } });

  console.log(`Article ${article.id}: appended a real update (${newSourceArticles.length} new source(s), ${gateNote}).`);
}

// Exported so apps/worker/src/index.ts can call this periodically (a real
// scheduled trigger, not just a manual CLI run — see that file's own
// scheduleWriteArticles()) without spawning a subprocess per cycle.
// Deliberately does NOT touch process.exitCode or prisma.$disconnect() —
// both belong to the CLI-only block at the bottom of this file, since a
// long-running caller (the worker process) owns its own prisma
// connection lifecycle and must not have it torn down after one batch.
export async function runWriteArticleBatch(batchSize: number = DEFAULT_BATCH_SIZE): Promise<{ found: number }> {
  if (!env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set — nothing to write. Set it in .env first.");
    return { found: 0 };
  }

  const candidates = await prisma.story.findMany({
    where: { articles: { none: { locale: "en" } }, sourceArticles: { some: {} } },
    orderBy: [{ importanceScore: "desc" }, { lastUpdatedAt: "desc" }],
    take: batchSize,
    select: {
      id: true,
      title: true,
      summary: true,
      primaryTopic: { select: { slug: true } },
      sourceArticles: {
        take: 5,
        orderBy: { fetchedAt: "desc" },
        select: { id: true, title: true, url: true, excerpt: true, embedding: true, source: { select: { name: true } } },
      },
    },
  });

  console.log(`Found ${candidates.length} Story(ies) with no English article yet (batch size ${batchSize}).`);

  for (const story of candidates) {
    await writeOne(story);
  }

  // Real second path closed 2026-09-09 (see updateOne()'s own comment for
  // the full story): Stories that already have an EN article but have
  // gathered genuinely new coverage since it was written. `lastUpdatedAt`
  // isn't itself the filter (ingest.ts sets it — and Story.status to
  // UPDATED — on the FIRST piece of additional coverage ever, and never
  // resets either, so both would perpetually match every Story that was
  // ever updated even once, real or not) — the real per-Story check below
  // (`sa.fetchedAt > article's own updatedAt`) is what actually decides
  // "new since last write", computed per-Story since it depends on that
  // Story's own article's own timestamp, not expressible as a single flat
  // Prisma `where`.
  const updateCandidates = await prisma.story.findMany({
    where: { articles: { some: { locale: "en" } } },
    orderBy: { lastUpdatedAt: "desc" },
    take: batchSize,
    select: {
      id: true,
      primaryTopic: { select: { slug: true } },
      articles: {
        where: { locale: "en" },
        select: { id: true, headline: true, contentPurpose: true, status: true, updatedAt: true, blocks: { where: { type: "TEXT" }, orderBy: { position: "asc" } } },
      },
      sourceArticles: { orderBy: { fetchedAt: "desc" }, take: 10, select: { id: true, title: true, url: true, excerpt: true, fetchedAt: true, source: { select: { name: true } } } },
    },
  });

  let updated = 0;
  for (const story of updateCandidates) {
    const article = story.articles[0];
    if (!article) continue; // structurally shouldn't happen given the `where` above
    const newSourceArticles = story.sourceArticles.filter((sa) => sa.fetchedAt > article.updatedAt);
    if (newSourceArticles.length === 0) continue; // the common case — no genuinely new coverage since the last write, nothing to do

    const decision = decideComposition({
      desiredPurpose: article.contentPurpose,
      existingArticles: story.articles.map((a) => ({ id: a.id, contentPurpose: a.contentPurpose, status: a.status })),
      knowledgeDelta: newSourceArticles.length,
    });

    if (decision.decision === "UPDATE") {
      const existingParagraphs = article.blocks.map((b) => (b.data as { text?: string }).text ?? "").filter(Boolean);
      const nextPosition = article.blocks.length > 0 ? Math.max(...article.blocks.map((b) => b.position)) + 1 : 0;
      await updateOne(story, { id: article.id, headline: article.headline, existingParagraphs, nextPosition }, newSourceArticles);
      updated++;
    } else {
      // REJECT can't actually happen here (guarded above by newSourceArticles.length === 0),
      // but MERGE/SPLIT are real, rare edge cases (see composition.ts's own
      // comment on when each fires) worth a log line rather than silence —
      // this project's own established "surface it, don't swallow it" posture.
      console.log(`Story ${story.id}: composition engine returned "${decision.decision}" for an update candidate, not UPDATE — ${decision.reason}`);
    }
  }

  return { found: candidates.length + updated };
}

// CLI-only: only runs when this file is executed directly (`npm run
// write:articles`), never when imported as a module (apps/worker/src/
// index.ts imports runWriteArticleBatch() above without triggering this
// block or disconnecting the shared prisma client out from under the
// rest of the worker process).
if (import.meta.url === `file://${process.argv[1]}`) {
  runWriteArticleBatch()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
