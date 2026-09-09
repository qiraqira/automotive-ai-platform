import { prisma } from "@automotive/database";
import { ENTITY_TYPE, type IngestResult } from "@automotive/types";
import { classifyTopic, extractCarModelMentions, computeImportanceScore, type CarModelCandidate } from "@automotive/editorial";
import { parseFeed } from "./rss.js";
import { normalizeUrl, hashUrl } from "./url.js";
import { checkRobotsAllowed } from "./robots.js";
import { getEmbedding, cosineSimilarity, EMBEDDING_SIMILARITY_THRESHOLD } from "./embed.js";

const CRAWLER_USER_AGENT = "Mozilla/5.0 (compatible; AutomotivePlatformBot/0.1)";

// Real gap found and fixed 2026-09-07: this fetch had no timeout at all —
// a real source server that hangs (under load, a network issue, a
// misconfigured proxy — not a contrived scenario) would block this job
// indefinitely rather than failing. BullMQ's own concurrency (5, see
// scheduler.ts) means enough simultaneously-hung sources could eventually
// starve every real ingestion slot. 30s is generous for a real RSS/Atom
// feed response while still failing well within a source's own
// crawlInterval (the shortest real seeded value is 900s). A timeout
// throws the same kind of Error the existing try/catch below already
// handles (records result.errors, a real SystemAlert, Source.lastError)
// — no new error-handling path needed, just closing off the one failure
// mode ("hangs forever") that wasn't already covered by one that fails
// with a reason.
const FEED_FETCH_TIMEOUT_MS = 30_000;

/** All real CarModels, reshaped into extractCarModelMentions()'s candidate
 * shape (own name + real trim names — never the Brand name alone, see
 * packages/editorial/src/entity-extractor.ts for why). Fetched once per
 * ingestSource() call, not per item, since the catalog doesn't change
 * mid-run. */
async function loadCarModelCandidates(): Promise<CarModelCandidate[]> {
  const carModels = await prisma.carModel.findMany({
    include: { generations: { include: { trims: true } } },
  });
  return carModels.map((cm) => ({
    id: cm.id,
    matchTerms: [cm.name, ...cm.generations.flatMap((g) => g.trims.map((t) => t.name))],
  }));
}

/** Real gap found and fixed 2026-09-07: `SourceAuthor` has sat entirely
 * unused since the initial schema scaffold — every real byline
 * `parseFeed()` could ever see was silently discarded before this. No
 * unique constraint exists on `(sourceId, name)` (a schema-level
 * simplification accepted rather than adding a migration for it — see
 * project memory), so this does its own find-then-create; safe because
 * `ingestSource()` processes items sequentially within one run, and
 * `sourceId` scoping means two different sources' same-named authors
 * (a real possibility — a syndicated wire byline) never collide. */
export async function resolveSourceAuthor(sourceId: string, name: string): Promise<string> {
  const existing = await prisma.sourceAuthor.findFirst({ where: { sourceId, name } });
  if (existing) return existing.id;
  const created = await prisma.sourceAuthor.create({ data: { sourceId, name } });
  return created.id;
}

/** Creates a real Knowledge Graph edge (spec §25) from a Story to a
 * CarModel it precisely mentions — the automated counterpart to the one
 * hand-seeded edge in packages/database/src/seed.ts. Idempotent: skips if
 * the edge already exists (same check seed.ts uses). */
async function linkStoryToCarModels(storyId: string, title: string, candidates: CarModelCandidate[]): Promise<void> {
  const matchedCarModelIds = extractCarModelMentions(title, candidates);
  for (const carModelId of matchedCarModelIds) {
    const existing = await prisma.entityRelation.findFirst({
      where: { fromType: ENTITY_TYPE.STORY, fromId: storyId, toType: ENTITY_TYPE.CAR_MODEL, toId: carModelId },
    });
    if (!existing) {
      await prisma.entityRelation.create({
        data: {
          fromType: ENTITY_TYPE.STORY,
          fromId: storyId,
          toType: ENTITY_TYPE.CAR_MODEL,
          toId: carModelId,
          relation: "mentions",
        },
      });
    }
  }
}

// How similar (0-1, pg_trgm `similarity()`) a new item's title has to be to
// an existing Story's most recent SourceArticle title to be considered the
// "same story" rather than a new one — and how recent that existing
// coverage has to be. Both are deliberately conservative for the MVP slice;
// see docs/editorial-system.md for the fuller independence/origin-graph
// logic this will grow into (embeddings + entity overlap, not just title
// text) once Phase 2 lands.
const TITLE_SIMILARITY_THRESHOLD = 0.45;
const CLUSTERING_WINDOW_HOURS = 72;

interface ClusterCandidate {
  storyId: string;
  similarity: number;
  /** true when this was matched via embedding cosine similarity (the
   * fallback below), false when pg_trgm's text-overlap check already
   * found it — surfaced in the real StoryEvent description so an admin
   * reading the timeline can tell the two apart. */
  viaEmbedding: boolean;
}

async function findClusterCandidate(title: string, newEmbedding: number[] | null): Promise<ClusterCandidate | null> {
  const since = new Date(Date.now() - CLUSTERING_WINDOW_HOURS * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<{ storyId: string; similarity: number }[]>`
    SELECT sa."storyId" AS "storyId", similarity(sa.title, ${title}) AS similarity
    FROM source_articles sa
    WHERE sa."storyId" IS NOT NULL
      AND sa."fetchedAt" > ${since}
      AND similarity(sa.title, ${title}) > ${TITLE_SIMILARITY_THRESHOLD}
    ORDER BY similarity DESC
    LIMIT 1
  `;

  const best = rows[0];
  if (best) return { storyId: best.storyId, similarity: best.similarity, viaEmbedding: false };

  // Real fallback added 2026-09-09 (see embed.ts's own comment for the
  // full motivation/verification): pg_trgm above is pure text overlap and
  // structurally can't catch two outlets covering the same event in
  // genuinely different words. Only reached when the trigram check above
  // already found nothing — an embedding call for every single item
  // regardless would be needless real spend for the common case (a
  // majority of real headlines about a genuinely new story, or ones
  // trigram already catches fine).
  if (!newEmbedding) return null;

  const candidates = await prisma.sourceArticle.findMany({
    where: { storyId: { not: null }, fetchedAt: { gt: since }, embedding: { isEmpty: false } },
    select: { storyId: true, embedding: true },
  });

  let bestMatch: ClusterCandidate | null = null;
  for (const c of candidates) {
    if (!c.storyId) continue;
    const sim = cosineSimilarity(newEmbedding, c.embedding);
    if (sim > EMBEDDING_SIMILARITY_THRESHOLD && (!bestMatch || sim > bestMatch.similarity)) {
      bestMatch = { storyId: c.storyId, similarity: sim, viaEmbedding: true };
    }
  }
  return bestMatch;
}

/** Fetches one Source's feed, ingests new items, attaches each to an
 * existing Story (if a recent, title-similar one exists) or creates a new
 * one. Idempotent per spec §61: re-running against the same feed content
 * only skips already-seen URLs, never creates duplicate SourceArticle or
 * Story rows. */
export async function ingestSource(sourceId: string): Promise<IngestResult> {
  const source = await prisma.source.findUniqueOrThrow({ where: { id: sourceId } });
  const result: IngestResult = {
    sourceId,
    itemsSeen: 0,
    articlesCreated: 0,
    duplicatesSkipped: 0,
    storiesCreated: 0,
    storiesUpdated: 0,
    errors: [],
  };

  // Real gap found and fixed 2026-09-07: the admin dashboard's real
  // "Sources" management (PATCH /v1/sources/:id, MANAGE_SOURCES-gated)
  // already lets an admin deactivate a source, but nothing ever checked
  // `active` here — a scheduled call for a just-deactivated source would
  // silently keep ingesting it. index.ts's reconciliation loop stops the
  // *scheduled* timer within its own poll window, but this check gives
  // immediate effect regardless of that timing, and also covers a direct
  // manual call (e.g. `ingest:once`, which does filter by active, but
  // this makes the guarantee live in the one place it actually matters).
  if (!source.active) {
    result.errors.push("Source is inactive — skipped, no fetch attempted");
    return result;
  }

  if (!source.feedUrl) {
    result.errors.push("Source has no feedUrl configured");
    return result;
  }

  // Real gap found and fixed 2026-09-07: `Source.robotsStatus` ("cached
  // robots.txt evaluation") has sat unused since the initial schema
  // scaffold — this crawler fetched every feed on every cycle without
  // ever checking whether the source's robots.txt actually permits it.
  // Verified live against all 3 real seeded sources' real robots.txt
  // files before wiring this in: none currently disallow their feed
  // path, so this is a real compliance check that happens to be a no-op
  // today — not a hypothetical one. Checked every call (not cached with
  // a TTL — no timestamp field exists to cache against, and one extra
  // small request per `crawlInterval` per source is not a politeness
  // concern at this scale, see robots.ts's own header comment).
  const robotsAllowed = await checkRobotsAllowed(source.feedUrl, CRAWLER_USER_AGENT);
  const robotsStatus = robotsAllowed ? "allowed" : "disallowed";
  if (source.robotsStatus !== robotsStatus) {
    await prisma.source.update({ where: { id: sourceId }, data: { robotsStatus } });
  }
  if (!robotsAllowed) {
    result.errors.push("robots.txt disallows this feed path — skipped, no fetch attempted");
    if (source.robotsStatus !== "disallowed") {
      await prisma.systemAlert.create({
        data: {
          severity: "WARNING",
          source: "crawler",
          message: `Source "${source.name}"'s robots.txt now disallows its feed path — ingestion stopped`,
          metadata: { sourceId, feedUrl: source.feedUrl },
        },
      });
    }
    return result;
  }

  let items;
  try {
    const res = await fetch(source.feedUrl, {
      headers: { "User-Agent": CRAWLER_USER_AGENT },
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    items = parseFeed(xml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(message);

    // spec §55-56 / docs/security.md "Observability": a crawler failure is
    // exactly what SystemAlert exists for. Only alert on a NEW failure (the
    // source was previously healthy, or the error message actually
    // changed) — a source stuck failing every crawlInterval must not
    // flood the alert feed with an identical alert every few minutes.
    if (source.lastError !== message) {
      await prisma.systemAlert.create({
        data: {
          severity: "WARNING",
          source: "crawler",
          message: `Source "${source.name}" failed to fetch: ${message}`,
          metadata: { sourceId, feedUrl: source.feedUrl },
        },
      });
    }

    await prisma.source.update({
      where: { id: sourceId },
      data: { lastErrorAt: new Date(), lastError: message },
    });
    return result;
  }

  result.itemsSeen = items.length;
  const carModelCandidates = await loadCarModelCandidates();

  for (const item of items) {
    try {
      const normalized = normalizeUrl(item.link);
      const urlHash = hashUrl(normalized);

      const existing = await prisma.sourceArticle.findUnique({ where: { urlHash } });
      if (existing) {
        result.duplicatesSkipped += 1;
        continue;
      }

      const embedding = await getEmbedding(item.title);
      const candidate = await findClusterCandidate(item.title, embedding);

      let storyId: string;
      if (candidate) {
        storyId = candidate.storyId;
        await prisma.story.update({
          where: { id: storyId },
          data: { lastUpdatedAt: new Date(), status: "UPDATED" },
        });
        result.storiesUpdated += 1;

        // Timeline entry (spec §9/§52 "story evolution") — each new piece
        // of coverage clustered into an existing Story is itself a real,
        // notable development worth recording, not just a silent counter
        // bump.
        await prisma.storyEvent.create({
          data: {
            storyId,
            occurredAt: new Date(),
            label: "new coverage",
            description: `Additional coverage from "${source.name}" (similarity ${candidate.similarity.toFixed(2)}, ${candidate.viaEmbedding ? "semantic" : "text"} match)`,
          },
        });
      } else {
        // Rule-based classification (packages/editorial's stand-in for the
        // AI Classifier pipeline stage, docs/ai-pipeline.md) — done once at
        // creation, not re-run on every update, since a story's subject
        // doesn't change as new coverage arrives.
        const topicSlug = classifyTopic(item.title);
        const topic = topicSlug ? await prisma.topic.findUnique({ where: { slug: topicSlug } }) : null;

        const story = await prisma.story.create({
          data: { title: item.title, status: "DISCOVERED", primaryTopicId: topic?.id },
        });
        storyId = story.id;
        result.storiesCreated += 1;

        await prisma.storyEvent.create({
          data: {
            storyId,
            occurredAt: new Date(),
            label: "discovered",
            description: `First reported by "${source.name}"`,
          },
        });
      }

      await linkStoryToCarModels(storyId, item.title, carModelCandidates);

      const authorId = item.author ? await resolveSourceAuthor(sourceId, item.author) : null;

      await prisma.sourceArticle.create({
        data: {
          sourceId,
          url: normalized,
          urlHash,
          title: item.title,
          excerpt: item.excerpt,
          publishedAt: item.publishedAt,
          storyId,
          authorId,
          embedding: embedding ?? [],
        },
      });

      await prisma.storySource.upsert({
        where: { storyId_sourceId: { storyId, sourceId } },
        update: {},
        create: { storyId, sourceId },
      });

      // Real gap found and fixed 2026-09-07: `Story.importanceScore` —
      // the single most heavily-weighted input to the homepage's real
      // `computeRankingScore()` (see packages/editorial's ranking.ts,
      // WEIGHTS.importance: 0.35, the largest of the five) — sat at its
      // schema default (30) for every Story ever ingested; nothing here
      // ever set it to anything else. Recomputed from the real, current
      // distinct-source count on every item (a no-op for a brand-new
      // single-source story, a real boost the moment a second outlet's
      // coverage clusters in).
      const distinctSourceCount = await prisma.storySource.count({ where: { storyId } });
      await prisma.story.update({
        where: { id: storyId },
        data: { importanceScore: computeImportanceScore(distinctSourceCount) },
      });

      result.articlesCreated += 1;
    } catch (err) {
      result.errors.push(`item "${item.title}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await prisma.source.update({
    where: { id: sourceId },
    data: { lastSuccessAt: new Date(), lastError: null },
  });

  return result;
}
