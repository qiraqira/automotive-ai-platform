import express from "express";
// Real gap found and fixed 2026-09-08, the most severe found this whole
// session: Express 4 does NOT catch a rejected Promise thrown by an
// `async (req, res) => {...}` route handler — verified live by POSTing a
// real fact with a bogus `marketId` to a running dev server and watching
// the Prisma FK-violation (P2003) become an uncaught exception that
// killed the entire Node process (confirmed dead: /health itself stopped
// responding for every other in-flight request, not just the bad one).
// Every route in this file is exactly this shape. This one-line shim
// (must load before any app.get/post/patch call, so it sits right after
// `express` itself) monkey-patches Express's router so an async
// handler's rejection reaches the existing error-handling middleware
// below instead of crashing the process — a well-known, minimal, single-
// purpose fix for exactly this Express-4-era gap, not a custom
// try/catch-everywhere rewrite.
import "express-async-errors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { z } from "zod";
import { prisma } from "@automotive/database";
import { env, qualityGateThresholds } from "@automotive/config";
import { evaluateQualityGate, type QualityScores } from "@automotive/editorial";
import { ENTITY_TYPE } from "@automotive/types";
import { hashPassword, comparePassword, signSession } from "./auth.js";
import { attachSession, requirePermission } from "./permissions.js";
import { rateLimit } from "./rate-limit.js";
import { requestLogger } from "./request-logger.js";

// Real gap found and fixed 2026-09-07 while building the audit-log admin
// page: `AuditLog.actorLabel`'s own schema comment calls it "a
// human-readable fallback", but every write site was setting it to
// `req.userId` — the raw User.id, not human-readable at all. Harmless
// while nothing ever read the table back; became a real UX bug the
// moment a human needed to actually read this feed. Falls back to the id
// only if the user record has since been deleted (actorUserId is a loose
// reference, not an enforced FK — see the AuditLog model comment).
async function auditActorLabel(userId: string | undefined): Promise<string> {
  if (!userId) return "unknown";
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? userId;
}

// The Express app itself, separated from index.ts's app.listen() call so
// integration tests (src/__tests__/*.test.ts) can import and exercise it
// directly with supertest, without binding a real port.
export const app = express();
// Real production topology (docs/deployment.md) always puts exactly one
// nginx reverse proxy in front of this service — trusting exactly one hop
// of X-Forwarded-For (not a blanket `true`, which would trust the whole
// chain) is what makes req.ip below resolve to the real client, not
// nginx's own address. Harmless locally/in tests: with no proxy header
// present, req.ip still resolves to the actual connecting socket either way.
app.set("trust proxy", 1);
// Real vulnerability found and mitigated 2026-09-07: `npm audit` flags 2
// moderate CVEs in `qs` (a transitive dep via `express`→`body-parser`) —
// an array-limit parsing bypass and a DoS via attacker-controlled input.
// The real fix (a newer `qs`) doesn't exist as a compatible upgrade:
// `body-parser@1.20.6` pins `qs: "~6.15.1"`, and the only release that
// bumps past the vulnerable range is `body-parser@2.x`, which requires
// Express 5 — a real breaking major-version migration across this whole
// file's middleware/routing, not something to do inside one tick without
// dedicated review and testing. Mitigated instead: Express's default
// `'extended'` query-string parser is what actually invokes `qs`;
// switching to `'simple'` uses Node's own `querystring.parse` and never
// touches `qs` at all. Verified every real query-param usage in this file
// (search's q/locale, stories' status/limit, alerts' resolved,
// redirects' path) is a flat single value — none use `qs`'s nested/array
// syntax (`?a[b]=c`, `?a[]=1`) — so this has zero functional impact here.
// Note: `npm audit` will still report the CVE (it checks the dependency
// graph, not actual runtime usage) — this eliminates the real
// exploitability in this app, it doesn't silence the audit finding.
// Track the real fix as: upgrade to Express 5 when that migration is
// deliberately scheduled, not smuggled in as a side effect of this.
app.set("query parser", "simple");
// Real gap found and fixed 2026-09-07: this service sent zero security
// headers beyond framework defaults (confirmed via curl — no
// X-Content-Type-Options, X-Frame-Options, etc., and `X-Powered-By:
// Express` actively advertised the stack to fingerprint). `helmet`
// (a single-purpose, widely-audited library) rather than hand-rolling
// these — unlike the in-memory rate limiter, there's no environment
// constraint here forcing a custom implementation, so use the
// well-tested standard instead of risking a subtly wrong hand-rolled
// version. Defaults are safe for a pure JSON API (this service never
// serves HTML) and disable `X-Powered-By` automatically.
app.use(helmet());
app.use(requestLogger);
app.use(express.json());
app.use(cookieParser());
app.use(attachSession);

// --- Health/readiness (docs/security.md "Observability") ---

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  } catch (err) {
    res.status(503).json({ status: "not_ready", error: err instanceof Error ? err.message : String(err) });
  }
});

// --- Auth ---

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// spec §48: login is explicitly named as needing rate limiting — a bare
// password-guessing loop otherwise has no cost. 10 attempts per 15
// minutes per IP: generous enough that a real user mistyping their
// password a few times never notices, tight enough to make brute-forcing
// impractical.
const loginRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

app.post("/v1/auth/login", loginRateLimit, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await comparePassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  if (user.status !== "ACTIVE") {
    res.status(403).json({ error: "account_not_active" });
    return;
  }

  const token = signSession({ userId: user.id });
  // Real gap found and fixed 2026-09-07: no `secure` flag meant the
  // session cookie would be sent over a plain HTTP connection in
  // production, not just HTTPS. Conditional on NODE_ENV rather than
  // always-on, since `secure: true` over this project's local dev/E2E
  // http://localhost setup would risk browsers refusing to store it.
  res.cookie(env.AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
  });
  res.json({ id: user.id, email: user.email, name: user.name });
});

app.post("/v1/auth/logout", (req, res) => {
  res.clearCookie(env.AUTH_COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/v1/auth/me", async (req, res) => {
  if (!req.userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, name: true, status: true, roles: { select: { role: { select: { key: true } } } } },
  });
  // Real gap found and fixed 2026-09-07, same fix as requirePermission()
  // in permissions.ts: `requireAdminSession()` (apps/web) calls this
  // endpoint to gate every real admin page, but it never checked
  // `status` — a suspended user's still-valid 7-day session cookie kept
  // rendering the full admin dashboard exactly as before, same root
  // cause (and same real severity) as the mutation-endpoint gap.
  if (!user || user.status !== "ACTIVE") {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  res.json({ id: user.id, email: user.email, name: user.name, roles: user.roles.map((r) => r.role.key) });
});

// --- Public read surface (spec §5) ---

app.get("/v1/sources", async (_req, res) => {
  const sources = await prisma.source.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      url: true,
      type: true,
      tier: true,
      trustScore: true,
      active: true,
      crawlInterval: true,
      lastSuccessAt: true,
      lastError: true,
      robotsStatus: true,
    },
  });
  res.json({ sources });
});

const storiesQuerySchema = z.object({
  status: z
    .enum([
      "DISCOVERED",
      "CLUSTERING",
      "RESEARCHING",
      "FACT_CHECK",
      "EDITORIAL_DRAFT",
      "QUALITY_CHECK",
      "READY",
      "PUBLISHED",
      "UPDATED",
      "ARCHIVED",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Real gap found and fixed 2026-09-07: this endpoint has always
  // accepted a `limit` but never an `offset` — with 150+ real Stories in
  // this dev DB (and growing every real ingest cycle) and /admin/stories
  // calling this with limit:50, an editor could never see any Story
  // older than the 50 most-recently-updated ones through the admin UI at
  // all, no matter how many real stories actually existed. Same
  // "real data an editor can't reach" shape as nearly every other gap
  // fixed today, just found via a fresh angle (reviewing /admin/stories
  // itself, not re-auditing an already-fixed pattern).
  offset: z.coerce.number().int().min(0).default(0),
  // Real gap found and fixed 2026-09-09, user's explicit request (they
  // directly noticed the homepage's own "Latest" feed was mostly raw,
  // just-ingested Stories with no real Article behind them at all —
  // confirmed live: 19 of the real top 20 by lastUpdatedAt had zero
  // real PUBLISHED English Article). This endpoint is deliberately
  // shared with /admin/stories, whose entire purpose is showing an
  // editor every Story regardless of write/publish status — the
  // unfiltered default stays exactly as-is for that caller. Opt-in only:
  // apps/web's own public reader-facing "Latest" feed passes this
  // explicitly (see apps/web/src/lib/api.ts's getStories()), nothing
  // else does.
  hasArticle: z.coerce.boolean().optional(),
});

app.get("/v1/stories", async (req, res) => {
  const parsed = storiesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
    return;
  }

  const rows = await prisma.story.findMany({
    where: {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.hasArticle ? { articles: { some: { status: "PUBLISHED", locale: "en" } } } : {}),
    },
    orderBy: { lastUpdatedAt: "desc" },
    // Fetches one extra row to detect a real next page without a
    // separate COUNT query — trimmed back to the real requested limit
    // before returning.
    take: parsed.data.limit + 1,
    skip: parsed.data.offset,
    include: {
      _count: { select: { sourceArticles: true } },
      sources: { include: { source: { select: { name: true, trustScore: true } } } },
      primaryTopic: { select: { slug: true, name: true } },
      events: { orderBy: { occurredAt: "desc" }, take: 5 },
      // Real gap found and fixed 2026-09-07: `SourceAuthor` sat entirely
      // unused since the initial schema scaffold — ingestSource() now
      // resolves a real byline from feeds that provide one (e.g.
      // electrek.co's `<dc:creator>`; insideevs.com/motor1.com provide
      // none — an honest per-source gap, not hidden). `author: true`
      // included here so an editor can actually see it; `select` (not
      // the whole row) since only the name is ever displayed.
      sourceArticles: {
        orderBy: { fetchedAt: "desc" },
        take: 5,
        select: { id: true, title: true, url: true, author: { select: { name: true } } },
      },
      // Real, published AI-written article for this Story, if the Writer
      // stage has produced one yet (packages/ai's AnthropicProvider +
      // apps/worker/src/write-article.ts) — lets the homepage/topic feed
      // link straight to a real article instead of only the raw source
      // headline. `take: 1` since a Story has at most one real published
      // English edition today (locale-per-edition, spec's own §3
      // principle — not multiple simultaneous EN articles per Story).
      articles: {
        where: { status: "PUBLISHED", locale: "en" },
        select: {
          slug: true,
          locale: true,
          images: { where: { role: "HERO" }, select: { image: { select: { originalUrl: true } } }, take: 1 },
        },
        take: 1,
      },
    },
  });
  const hasMore = rows.length > parsed.data.limit;
  const stories = hasMore ? rows.slice(0, parsed.data.limit) : rows;
  res.json({ stories, hasMore, offset: parsed.data.offset, limit: parsed.data.limit });
});

// --- Articles (spec's Writer stage output — see packages/ai's real
// AnthropicProvider + apps/worker/src/write-article.ts) ---

// Real gap found and fixed 2026-09-09: apps/web/src/app/sitemap.ts's own
// original comment ("Article URLs join this once apps/web has article
// pages") was accurate when written but never revisited once the Writer
// stage (apps/worker/src/write-article.ts) and the real article page
// both landed — 0 of the (at the time) 105 real published articles were
// ever discoverable via the sitemap, the primary mechanism search
// engines use to find new content on a young site with few backlinks.
// This is that missing list endpoint. No pagination — sitemaps support
// up to 50,000 URLs each and this is nowhere near that scale; revisit
// with a real sitemap index (multiple <sitemap> files) if it ever is,
// not preemptively.
app.get("/v1/articles", async (_req, res) => {
  const rows = await prisma.article.findMany({
    where: { status: "PUBLISHED" },
    select: {
      locale: true,
      slug: true,
      publishedAt: true,
      updatedAt: true,
      factualScore: true,
      sourceScore: true,
      qualityScore: true,
      originalityScore: true,
      valueScore: true,
      readabilityScore: true,
    },
    orderBy: { publishedAt: "desc" },
    take: 5000,
  });
  // Same 2026-09-11 quality-gate finding as the article-detail route
  // above: a "reject"-verdict article is set noindex there, so it
  // shouldn't also be advertised to crawlers via the sitemap feed.
  const articles = rows
    .filter((a) => {
      if (a.factualScore === null || a.sourceScore === null) return true;
      const scores: QualityScores = {
        qualityScore: a.qualityScore ?? 0,
        originalityScore: a.originalityScore ?? 0,
        factualScore: a.factualScore,
        sourceScore: a.sourceScore,
        valueScore: a.valueScore ?? 0,
        readabilityScore: a.readabilityScore ?? 0,
      };
      return evaluateQualityGate(scores, qualityGateThresholds).verdict !== "reject";
    })
    .map(({ locale, slug, publishedAt, updatedAt }) => ({ locale, slug, publishedAt, updatedAt }));
  res.json({ articles });
});

app.get("/v1/articles/:locale/:slug", async (req, res) => {
  const locale = req.params.locale;
  if (locale !== "en" && locale !== "es") {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const article = await prisma.article.findFirst({
    where: { locale, slug: req.params.slug, status: "PUBLISHED" },
    include: {
      blocks: { orderBy: { position: "asc" } },
      story: { select: { id: true, title: true } },
      // Real free-stock hero images (apps/worker/src/fetch-images.ts,
      // Wikimedia Commons) — `role: "HERO"` since ArticleImage also
      // supports INLINE/GALLERY/OG roles nothing writes yet.
      images: { where: { role: "HERO" }, include: { image: true }, take: 1 },
      // Real gap found and fixed 2026-09-09, user's explicit request
      // (they directly noticed published articles with no visible
      // source link): apps/worker/src/write-article.ts now creates a
      // real Citation row per SourceArticle actually used to write the
      // piece — this endpoint never returned them to the frontend at
      // all until now, so the article page had nothing real to render
      // even once the writer started producing them.
      citations: { select: { id: true, label: true, url: true } },
    },
  });

  if (!article) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // 2026-09-11 retroactive quality-gate backfill scored every published
  // article against its own cited sources (fact-check re-verification,
  // not the original draft-time check — AUTO_MODERATION was off when
  // most of this corpus was written, so it never actually ran). ~65% of
  // the corpus came back "reject" (fabricated/unsupported claims beyond
  // what sources say). Unpublishing all of them outright would 404 a
  // large batch of already-indexed URLs at once — noindex instead keeps
  // the URL alive (no broken links, no lost link equity) while pulling
  // it out of search results until it's rewritten or deliberately
  // removed. Only "reject" is treated this way; "review" is a lower-
  // confidence signal left indexed pending manual triage.
  let qualityVerdict: "publish" | "review" | "reject" | null = null;
  if (article.factualScore !== null && article.sourceScore !== null) {
    const scores: QualityScores = {
      qualityScore: article.qualityScore ?? 0,
      originalityScore: article.originalityScore ?? 0,
      factualScore: article.factualScore,
      sourceScore: article.sourceScore,
      valueScore: article.valueScore ?? 0,
      readabilityScore: article.readabilityScore ?? 0,
    };
    qualityVerdict = evaluateQualityGate(scores, qualityGateThresholds).verdict;
  }

  res.json({ article: { ...article, qualityVerdict } });
});

// --- Article review queue (spec's "AI assisted, not autonomous" —
// AUTO_PUBLISH controls whether apps/worker/src/write-article.ts's Writer
// stage publishes directly or lands here as DRAFT for a human with
// PUBLISH_ARTICLE to review first; see README's AI Writer stage row) ---

const adminArticlesQuerySchema = z.object({
  status: z.enum(["DRAFT", "IN_REVIEW", "PUBLISHED", "UPDATED", "ARCHIVED", "REJECTED", "SCHEDULED"]).default("DRAFT"),
  offset: z.coerce.number().int().min(0).default(0),
});

app.get("/v1/admin/articles", requirePermission("UPDATE_ARTICLE"), async (req, res) => {
  const parsed = adminArticlesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
    return;
  }
  const LIMIT = 50;
  const rows = await prisma.article.findMany({
    where: { status: parsed.data.status },
    orderBy: { createdAt: "desc" },
    take: LIMIT + 1,
    skip: parsed.data.offset,
    include: {
      story: { select: { id: true, title: true } },
      // A human reviewing a DRAFT here is the real safety net for
      // apps/worker/src/fetch-images.ts's real but imperfect Commons
      // relevance matching (see that file's own comments on two real
      // false-positive shapes found live) — showing the image before
      // Publish means a bad match gets caught by a person, not
      // published silently.
      images: { where: { role: "HERO" }, include: { image: true }, take: 1 },
    },
  });
  const hasMore = rows.length > LIMIT;
  const articles = hasMore ? rows.slice(0, LIMIT) : rows;
  res.json({ articles, hasMore, offset: parsed.data.offset, limit: LIMIT });
});

async function setArticleStatus(req: express.Request, res: express.Response, status: "PUBLISHED" | "REJECTED", action: string) {
  const before = await prisma.article.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const after = await prisma.article.update({
    where: { id: req.params.id },
    data: status === "PUBLISHED" ? { status, publishedAt: before.publishedAt ?? new Date() } : { status },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action,
      entityType: "Article",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  res.json(after);
}

app.patch("/v1/admin/articles/:id/publish", requirePermission("PUBLISH_ARTICLE"), async (req, res) => {
  await setArticleStatus(req, res, "PUBLISHED", "publish_article");
});

app.patch("/v1/admin/articles/:id/reject", requirePermission("PUBLISH_ARTICLE"), async (req, res) => {
  await setArticleStatus(req, res, "REJECTED", "reject_article");
});

// User's explicit instruction: search free stock first (see the
// apps/worker/src/fetch-images.ts row in README), upload one manually
// (e.g. a ChatGPT-generated image) when nothing free was found. The
// actual file bytes are handled entirely by apps/web's own route
// handler (writes to the real persistent uploads_data volume, computes
// the real sha256 from the real uploaded bytes) — this endpoint only
// registers the resulting Image/ArticleImage metadata, matching the
// same division of responsibility as every other admin write here.
const heroImageUploadSchema = z.object({
  url: z.string().min(1),
  sha256: z.string().length(64),
  mimeType: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  altText: z.string().optional(),
});

app.post("/v1/admin/articles/:id/hero-image", requirePermission("UPDATE_ARTICLE"), async (req, res) => {
  const parsed = heroImageUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const article = await prisma.article.findUnique({ where: { id: req.params.id } });
  if (!article) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const { url, sha256, mimeType, width, height, altText } = parsed.data;

  // Real dedupe: the exact same uploaded file might already be
  // registered (e.g. a re-upload retry) — same `sha256`-first pattern
  // as apps/worker/src/fetch-images.ts's Commons path.
  const existingImage = await prisma.image.findUnique({ where: { sha256 } });
  const image = existingImage
    ? existingImage
    : await prisma.image.create({
        data: {
          originalUrl: url,
          localStorageUrl: url,
          sourceType: "AI_GENERATED",
          rightsStatus: "OFFICIAL_USE_ALLOWED",
          attribution: "AI-generated image, uploaded by an editor — no third-party rights involved.",
          generatedByAi: true,
          sha256,
          mimeType,
          width,
          height,
        },
      });

  // Replaces any existing HERO image for this Article (a real, deliberate
  // "swap in a better one" flow — an editor uploading their own image is
  // very plausibly replacing an imperfect free-stock auto-match, not
  // just adding a second one).
  await prisma.articleImage.deleteMany({ where: { articleId: article.id, role: "HERO" } });
  await prisma.articleImage.create({
    data: { articleId: article.id, imageId: image.id, role: "HERO", position: 0, altText: altText ?? article.headline },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "upload_hero_image",
      entityType: "Article",
      entityId: article.id,
      after: { imageId: image.id, url } as unknown as object,
    },
  });

  res.status(201).json({ image });
});

// --- Search (spec §32) ---

const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  locale: z.enum(["en", "es"]).default("en"),
});

// spec §48: search is the other endpoint named explicitly — each query
// runs a real DB query plus a SearchQuery write, so an unbounded query
// loop is both a DB-load and a SearchQuery-spam vector. Generous limit
// (a real user typing/refining a search several times a minute is normal)
// that still bounds automated abuse.
const searchRateLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });

app.get("/v1/search", searchRateLimit, async (req, res) => {
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
    return;
  }
  const { q, locale } = parsed.data;

  // Searches the two real content types that exist today (Stories,
  // CarModels/Brands) — spec §32 also lists articles/technologies/people/
  // companies, which join once those entities have real rows to search
  // (see README.md status table). pg_trgm similarity() again, same
  // approach as the existing story-clustering search in apps/worker.
  const [stories, carModels] = await Promise.all([
    // word_similarity(), not similarity(): similarity() compares the whole
    // query string against the whole title, so a short query like "Tesla"
    // against a long headline scores very low (~0.06-0.09, confirmed
    // against real data) even for an exact word match — word_similarity()
    // measures the best match against any substring, which is what a
    // keyword search actually needs. Caught by testing against real
    // ingested titles, not assumed from the function names.
    prisma.$queryRaw<{ id: string; title: string; similarity: number }[]>`
      SELECT id, title, word_similarity(${q}, title) AS similarity
      FROM stories
      WHERE word_similarity(${q}, title) > 0.4
      ORDER BY similarity DESC
      LIMIT 10
    `,
    // Matches on the car's own name OR its brand's name — a plain
    // `name: contains` alone misses a brand-only query like "BMW" (found
    // while writing apps/web's e2e search test: it returned zero cars for
    // "BMW" despite "BMW 3 Series" existing, since "BMW" isn't a substring
    // of CarModel.name "3 Series").
    prisma.carModel.findMany({
      where: {
        OR: [{ name: { contains: q, mode: "insensitive" } }, { brand: { name: { contains: q, mode: "insensitive" } } }],
      },
      include: { brand: true },
      take: 10,
    }),
  ]);

  const resultsCount = stories.length + carModels.length;
  await prisma.searchQuery.create({ data: { query: q, locale, resultsCount } });

  // Real gap found and fixed 2026-09-10: this endpoint returned only
  // {id, title} per story, with no way for apps/web to link to the
  // article — every real search result rendered as unclickable plain
  // text (apps/web/src/app/search/page.tsx only wrapped carModels in an
  // <a>). Same "first PUBLISHED en Article" lookup already used by
  // GET /v1/stories and GET /v1/topics/:slug, just applied to this
  // endpoint's own raw-SQL result set (word_similarity() ordering is
  // preserved by mapping over `stories`, not the follow-up query's own
  // unordered result).
  const storyIds = stories.map((s) => s.id);
  const articlesByStoryId = new Map<string, string>();
  if (storyIds.length > 0) {
    const storiesWithArticles = await prisma.story.findMany({
      where: { id: { in: storyIds } },
      select: { id: true, articles: { where: { status: "PUBLISHED", locale: "en" }, select: { slug: true }, take: 1 } },
    });
    for (const s of storiesWithArticles) {
      if (s.articles[0]) articlesByStoryId.set(s.id, s.articles[0].slug);
    }
  }

  res.json({
    stories: stories.map((s) => ({ id: s.id, title: s.title, articleSlug: articlesByStoryId.get(s.id) ?? null })),
    carModels: carModels.map((c) => ({ brandSlug: c.brand.slug, modelSlug: c.slug, name: `${c.brand.name} ${c.name}` })),
  });
});

// --- Markets (spec §90-91's time/market-aware Fact system) ---

// Real gap found and fixed 2026-09-07: 4 real Market rows have existed
// since seed.ts's original scaffold (US/GB/ES/MX, each with a real
// currencyCode/unitSystem), and POST /v1/cars/:brandSlug/:modelSlug/
// facts has accepted an optional marketId since the fact-correction
// endpoint itself was built — but nothing could ever read the market
// list back, so /admin/cars's "Add fact" form had no way to offer a
// market picker and every editor-added Fact was silently global
// (marketId omitted) even for something obviously market-specific like
// the form's own "price" placeholder example. Public read (reference
// data, not sensitive — same as /v1/cars, /v1/topics), no auth needed.
app.get("/v1/markets", async (_req, res) => {
  const markets = await prisma.market.findMany({ orderBy: { code: "asc" } });
  res.json({ markets });
});

// --- Car pages (spec §24) ---

// List of all car model slugs — exists specifically so apps/web's
// sitemap.ts (spec §29-31) has something real to enumerate, instead of a
// sitemap that only ever lists the homepage.
// `lastModified` added 2026-09-08 (real gap: apps/web/src/app/sitemap.ts
// never set it anywhere, despite real timestamp data existing) — the most
// recent real `Fact.createdAt` for this car, or `null` if it has none yet
// (a real, valid state: a CarModel can exist with generations/trims but no
// Fact recorded). Deliberately not `Generation`/`Trim`/`Engine` timestamps
// too — those have none in the schema today, and Fact is the one real,
// queryable "this page's content changed" signal that already exists.
app.get("/v1/cars", async (_req, res) => {
  const carModels = await prisma.carModel.findMany({
    select: {
      slug: true,
      brand: { select: { slug: true } },
      facts: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  res.json({
    carModels: carModels.map((c) => ({
      brandSlug: c.brand.slug,
      modelSlug: c.slug,
      lastModified: c.facts[0]?.createdAt ?? null,
    })),
  });
});

app.get("/v1/cars/:brandSlug/:modelSlug", async (req, res) => {
  const carModel = await prisma.carModel.findFirst({
    where: { slug: req.params.modelSlug, brand: { slug: req.params.brandSlug } },
    include: {
      brand: true,
      // Real gap found and fixed 2026-09-08: no `orderBy` here at all —
      // verified live (a real, deliberately-out-of-chronological-order
      // insertion: a 2025 generation created before a 1990 one) that
      // generations come back in plain insertion order, not chronological
      // order, so a real editor backfilling a car's older generations
      // after its current one already exists (a natural way to actually
      // use the real "Add generation" admin feature) would scramble the
      // real public car page's display order. `startYear` can be null
      // (optional in the schema) — Postgres sorts nulls last by default
      // for `asc`, which is the right behavior here too (an
      // unknown-start-year generation shouldn't jump to the front).
      generations: {
        orderBy: { startYear: "asc" },
        include: {
          // Real gap found and fixed 2026-09-08, same pass as the
          // generations fix above: trims/engines/batteries had no
          // ordering either. Neither model has a `createdAt` field to
          // sort by (no schema migration for this) — `id` (a real cuid,
          // lexicographically time-ordered by construction) is the
          // closest available proxy for "order added," a real
          // improvement over relying on whatever order Postgres happens
          // to return with no ORDER BY at all, same underlying risk as
          // the generations case just without an equally dramatic
          // real-world scenario to demonstrate it live.
          trims: { orderBy: { id: "asc" }, include: { engines: { orderBy: { id: "asc" } }, batteries: { orderBy: { id: "asc" } } } },
        },
      },
      facts: { include: { market: true }, orderBy: { validFrom: "desc" } },
    },
  });

  if (!carModel) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // spec §25 Knowledge Graph: real Story<->Car edges via EntityRelation
  // (packages/database/prisma/schema.prisma — deliberately no FK on
  // fromId/toId, see that model's comment for why; validated by fromType/
  // toType here in application code instead). Populated two ways: one
  // hand-seeded edge (packages/database/src/seed.ts) plus real automated
  // extraction as of 2026-09-07 — apps/worker/src/ingest.ts calls
  // packages/editorial's extractCarModelMentions() on every ingested item,
  // creating this edge automatically for any title precisely mentioning a
  // real CarModel/trim name.
  const relations = await prisma.entityRelation.findMany({
    where: { toType: ENTITY_TYPE.CAR_MODEL, toId: carModel.id, fromType: ENTITY_TYPE.STORY },
  });
  // Real gap found and fixed 2026-09-08: no `orderBy` at all — only 1
  // real related story exists for any real car today (entity extraction
  // is real but still young), so this hasn't visibly scrambled a real
  // page yet, but it's the exact same latent risk as the generations/
  // trims ordering fixed earlier the same day, and every OTHER real
  // story list in this app (the homepage feed, topic pages,
  // /admin/stories) already orders by `lastUpdatedAt: desc` — "Related
  // stories" is the same kind of list and was the one missing it.
  const relatedStories =
    relations.length > 0
      ? await prisma.story.findMany({
          where: { id: { in: relations.map((r) => r.fromId) } },
          orderBy: { lastUpdatedAt: "desc" },
        })
      : [];

  res.json({ carModel, relatedStories: relatedStories.map((s) => ({ id: s.id, title: s.title })) });
});

// --- Topics (rule-based Classifier stand-in — packages/editorial's
// topic-classifier.ts, wired into apps/worker/src/ingest.ts at Story
// creation) ---

// Same reason as GET /v1/cars: exists so apps/web's sitemap.ts has real
// topic slugs to enumerate. Real gap found and fixed 2026-09-07: topic
// pages existed and were linked from the homepage, but were never added
// to the sitemap — a real SEO regression, not a stub that was never
// finished.
// Real, breaking-but-small shape change 2026-09-08: this used to return
// `topics: string[]` — widened to `{ slug, lastModified }[]` so
// apps/web/src/app/sitemap.ts has a real `lastModified` signal (the most
// recent real `Story.lastUpdatedAt` among this topic's stories, or `null`
// for a topic with none yet). Both real callers (apps/web/src/app/
// page.tsx, sitemap.ts) updated to read `.slug` instead of treating each
// element as a bare string; the existing test asserting the old shape
// updated too (see api.test.ts).
app.get("/v1/topics", async (_req, res) => {
  const topics = await prisma.topic.findMany({
    select: {
      slug: true,
      stories: { select: { lastUpdatedAt: true }, orderBy: { lastUpdatedAt: "desc" }, take: 1 },
    },
  });
  res.json({
    topics: topics.map((t) => ({
      slug: t.slug,
      lastModified: t.stories[0]?.lastUpdatedAt ?? null,
    })),
  });
});

app.get("/v1/topics/:slug", async (req, res) => {
  const topic = await prisma.topic.findUnique({ where: { slug: req.params.slug } });
  if (!topic) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const stories = await prisma.story.findMany({
    // Real gap found and fixed 2026-09-09, user's explicit request (see
    // GET /v1/stories' own new `hasArticle` comment for the full story
    // — the identical bug, found here independently): this endpoint is
    // exclusively the public topic page's + the homepage's per-topic
    // sections' data source (no admin caller shares it), so filtering
    // by default — rather than an opt-in param like /v1/stories' — is
    // safe and correct: a reader-facing topic feed should never show a
    // raw, unwritten Story stub with nothing real to read.
    where: { primaryTopicId: topic.id, articles: { some: { status: "PUBLISHED", locale: "en" } } },
    orderBy: { lastUpdatedAt: "desc" },
    take: 50,
    include: {
      _count: { select: { sourceArticles: true } },
      sources: { include: { source: { select: { name: true, trustScore: true } } } },
      primaryTopic: { select: { slug: true, name: true } },
      events: { orderBy: { occurredAt: "desc" }, take: 5 },
      // Real gap found and fixed 2026-09-08 (same tick as adding this
      // field to GET /v1/stories, for the same reason — linking a real
      // AI-written article, when one exists, from the topic feed too).
      // Missing this here (while GET /v1/stories had it) crashed
      // apps/web's topic page live — `story.articles[0]` on `undefined`
      // — caught immediately after the first real deploy with a real
      // Article in the DB, not by inspection.
      articles: {
        where: { status: "PUBLISHED", locale: "en" },
        select: {
          slug: true,
          locale: true,
          images: { where: { role: "HERO" }, select: { image: { select: { originalUrl: true } } }, take: 1 },
        },
        take: 1,
      },
    },
  });

  res.json({ topic, stories });
});

// --- Analytics (spec §49) ---

const analyticsEventSchema = z.object({
  type: z.string().min(1).max(50),
  path: z.string().min(1),
  sessionId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Real gap found and fixed 2026-09-07: this is the third real public,
// unauthenticated write endpoint (after login and search), but
// docs/security.md's own "real, current state" accounting of rate
// limiting only ever named two — this one was missed entirely, with no
// rate limit of any kind, on an endpoint every real page navigation
// hits automatically. 120/min per IP: real browsing can fire this a
// few times a minute at most (one event per real navigation, prefetches
// already filtered out above), so this only bites a script hammering
// the endpoint directly. Keying works correctly only because
// `apps/web/src/proxy.ts` now relays the real client's `X-Forwarded-For`
// on its internal call here — see that file's own comment on why that
// relay is required for this specific endpoint.
const analyticsEventRateLimit = rateLimit({ windowMs: 60 * 1000, max: 120 });

app.post("/v1/analytics/events", analyticsEventRateLimit, async (req, res) => {
  const parsed = analyticsEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }
  await prisma.analyticsEvent.create({
    data: {
      type: parsed.data.type,
      path: parsed.data.path,
      sessionId: parsed.data.sessionId,
      metadata: parsed.data.metadata as object | undefined,
    },
  });
  res.status(201).json({ ok: true });
});

// Real gap found and fixed 2026-09-07: `apps/web`'s proxy.ts has written
// a real `AnalyticsEvent` on every pageview since that feature shipped,
// and `GET /v1/search` has written a real `SearchQuery` row (with its
// actual result count) on every search since that feature shipped — 1586
// and 373 real rows in this dev DB respectively as of today — but
// nothing anywhere ever read either table back. Both were exactly as
// write-only as `AuditLog` was before the audit-log admin page existed.
// `MANAGE_SYSTEM_SETTINGS`-gated (same operations/observability bucket
// as `/v1/alerts` and the new `/v1/redirects`) since, like redirects,
// there's no dedicated PermissionKey for analytics either.
app.get("/v1/analytics/pageviews", requirePermission("MANAGE_SYSTEM_SETTINGS"), async (_req, res) => {
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ["path"],
    where: { type: "pageview" },
    _count: { path: true },
    orderBy: { _count: { path: "desc" } },
    take: 20,
  });
  res.json({ pageviews: grouped.map((g) => ({ path: g.path, count: g._count.path })) });
});

// The real editorial signal here is a search that returned zero
// results — a reader looking for something this site doesn't have yet.
// Returned newest-first rather than pre-filtered so the admin page can
// show both (recent searches in general, and the zero-result ones stand
// out visually) without a second round trip.
// Real gap found and fixed 2026-09-07 (same day, later pass): same
// hardcoded-`take`-no-`offset` shape as the same-day Stories/Alerts/
// Audit-log fixes — checked live and found 722 real SearchQuery rows
// against this endpoint's old `take: 50`, meaning the admin page could
// never see the other 672, including any older zero-result searches.
const searchQueriesQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
});

app.get("/v1/search-queries", requirePermission("MANAGE_SYSTEM_SETTINGS"), async (req, res) => {
  const parsed = searchQueriesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
    return;
  }
  const rows = await prisma.searchQuery.findMany({
    orderBy: { createdAt: "desc" },
    take: 51,
    skip: parsed.data.offset,
  });
  const hasMore = rows.length > 50;
  const queries = hasMore ? rows.slice(0, 50) : rows;
  res.json({ queries, hasMore, offset: parsed.data.offset });
});

// --- System alerts (spec §55-56, MANAGE_SYSTEM_SETTINGS-gated) ---

// Real gap found and fixed 2026-09-07: same shape as the same-day
// GET /v1/stories fix — a hardcoded take with no offset. Only 1 real
// SystemAlert exists right now (checked live before writing this, not
// assumed), so this specific endpoint isn't hiding anything YET, but
// it's the same structural gap and would hit the same wall the moment
// alerts accumulate — fixed alongside the far more urgent audit-log
// case below rather than leaving a known-identical gap unfixed nearby.
const alertsQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
});

app.get("/v1/alerts", requirePermission("MANAGE_SYSTEM_SETTINGS"), async (req, res) => {
  const parsedQuery = alertsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "invalid_query", issues: parsedQuery.error.issues });
    return;
  }
  const resolved = req.query.resolved === "true" ? true : req.query.resolved === "false" ? false : undefined;
  const rows = await prisma.systemAlert.findMany({
    where: resolved === undefined ? undefined : { resolved },
    orderBy: { createdAt: "desc" },
    take: 101,
    skip: parsedQuery.data.offset,
  });
  const hasMore = rows.length > 100;
  const alerts = hasMore ? rows.slice(0, 100) : rows;
  res.json({ alerts, hasMore, offset: parsedQuery.data.offset });
});

// Real gap found and fixed 2026-09-07: `SystemAlert.resolved`/`resolvedAt`
// already existed in the schema, `GET /v1/alerts?resolved=` already
// supported filtering by it, and the admin page already *displayed*
// "resolved"/"unresolved" per row — but nothing anywhere could ever
// actually set it. Every alert was permanently unresolved by
// construction. Same permission gate + AuditLog pattern as
// `PATCH /v1/sources/:id`.
app.patch("/v1/alerts/:id/resolve", requirePermission("MANAGE_SYSTEM_SETTINGS"), async (req, res) => {
  const before = await prisma.systemAlert.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const after = await prisma.systemAlert.update({
    where: { id: req.params.id },
    data: { resolved: true, resolvedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "resolve_alert",
      entityType: "SystemAlert",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  res.json(after);
});

// Real gap found and fixed 2026-09-07: `PermissionKey.VIEW_AUDIT_LOG`
// already existed in the schema and every admin already had it granted
// (seed.ts's `admin` role gets `ALL_PERMISSIONS`), and two endpoints
// (`PATCH /v1/sources/:id`, `PATCH /v1/alerts/:id/resolve`) already write
// real `AuditLog` rows on every mutation — but no endpoint anywhere ever
// checked `VIEW_AUDIT_LOG` or read the table back, so the entire audit
// trail was permanently write-only. `entityType`/`entityId` query filters
// mirror the table's own `@@index([entityType, entityId])`.
// Second real gap found and fixed 2026-09-07 (same day, later pass):
// this endpoint's hardcoded `take: 100` had no offset, same shape as
// the same-day GET /v1/stories fix — and this one was already live: a
// real count taken before writing this fix found 1,562 real AuditLog
// rows already in this dev DB (every one of today's own admin
// mutations wrote one), meaning /admin/audit-log had already been
// silently hiding 1,400+ real historical entries for a page whose
// entire purpose is being the audit trail. The most urgent instance of
// this pagination gap found today, not a preemptive one.
const auditLogQuerySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
});

app.get("/v1/audit-log", requirePermission("VIEW_AUDIT_LOG"), async (req, res) => {
  const parsed = auditLogQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_query", issues: parsed.error.issues });
    return;
  }
  const rows = await prisma.auditLog.findMany({
    where: { entityType: parsed.data.entityType, entityId: parsed.data.entityId },
    orderBy: { createdAt: "desc" },
    take: 101,
    skip: parsed.data.offset,
  });
  const hasMore = rows.length > 100;
  const entries = hasMore ? rows.slice(0, 100) : rows;
  res.json({ entries, hasMore, offset: parsed.data.offset });
});

// --- Redirects (spec §29-31, §38 CMS "Redirects") ---

// Looked up by apps/web's middleware on (almost) every request — kept as
// a single indexed lookup by exact path (Redirect.fromPath is @unique in
// the schema) rather than loading the whole table, so this stays cheap
// even once real redirect volume exists.
app.get("/v1/redirects/lookup", async (req, res) => {
  const path = typeof req.query.path === "string" ? req.query.path : "";
  const redirect = await prisma.redirect.findUnique({ where: { fromPath: path } });
  if (!redirect) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ toPath: redirect.toPath, statusCode: redirect.statusCode });
});

// Real gap found and fixed 2026-09-07: every real Redirect row could only
// ever come from `seed.ts` — there was no way for an editor to add a new
// redirect (e.g. after renaming a car's slug) or fix a wrong `toPath`
// without a manual DB write, even though `GET /v1/redirects/lookup`
// above and `apps/web`'s proxy.ts have driven real 301s off this table
// since early in this project. No dedicated PermissionKey exists for
// redirects specifically (unlike the SystemAlert/AuditLog/User/Fact gaps
// fixed earlier today, each of which had its own already-granted-but-
// unchecked permission) — gated on `MANAGE_SYSTEM_SETTINGS` instead,
// the same permission already used for `/v1/alerts`, rather than adding
// a new enum value + migration for a single small CMS feature.
app.get("/v1/redirects", requirePermission("MANAGE_SYSTEM_SETTINGS"), async (_req, res) => {
  const redirects = await prisma.redirect.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ redirects });
});

const createRedirectSchema = z.object({
  fromPath: z.string().min(1).startsWith("/"),
  toPath: z.string().min(1).startsWith("/"),
  statusCode: z.union([z.literal(301), z.literal(302)]).optional(),
});

// Real gap found and fixed 2026-09-07: nothing anywhere rejected a
// redirect whose `toPath` creates a real infinite loop — `apps/web`'s
// proxy.ts resolves exactly one hop per request via a genuine browser
// 301/302 (see that file), so a self-referential `fromPath === toPath`
// or a two-hop cycle (creating A→B when B→A already exists) both send a
// real browser into ERR_TOO_MANY_REDIRECTS the moment anyone visits
// either real path — not a contrived edge case, a direct consequence of
// this endpoint's own one-hop-per-lookup design. Only checks the direct
// reverse hop, not a full N-path graph walk (an editor chaining
// A→B→C→A across three separate redirects is a real but far less likely
// data-entry mistake, and full cycle detection would cost an unbounded
// lookup chain on every single write) — a deliberately bounded, honest
// MVP check, same "cheap check that runs first" posture as the rate
// limiter above, not the whole class of possible cycles.
async function findsRedirectCycle(fromPath: string, toPath: string): Promise<boolean> {
  if (fromPath === toPath) return true;
  const reverse = await prisma.redirect.findUnique({ where: { fromPath: toPath } });
  return reverse?.toPath === fromPath;
}

app.post("/v1/redirects", requirePermission("MANAGE_SYSTEM_SETTINGS"), async (req, res) => {
  const parsed = createRedirectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const existing = await prisma.redirect.findUnique({ where: { fromPath: parsed.data.fromPath } });
  if (existing) {
    res.status(409).json({ error: "from_path_taken" });
    return;
  }

  if (await findsRedirectCycle(parsed.data.fromPath, parsed.data.toPath)) {
    res.status(409).json({ error: "redirect_cycle" });
    return;
  }

  const redirect = await prisma.redirect.create({ data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "create_redirect",
      entityType: "Redirect",
      entityId: redirect.id,
      after: redirect as unknown as object,
    },
  });

  res.status(201).json(redirect);
});

const updateRedirectSchema = z.object({
  toPath: z.string().min(1).startsWith("/"),
  statusCode: z.union([z.literal(301), z.literal(302)]).optional(),
});

app.patch("/v1/redirects/:id", requirePermission("MANAGE_SYSTEM_SETTINGS"), async (req, res) => {
  const parsed = updateRedirectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const before = await prisma.redirect.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  if (await findsRedirectCycle(before.fromPath, parsed.data.toPath)) {
    res.status(409).json({ error: "redirect_cycle" });
    return;
  }

  const after = await prisma.redirect.update({ where: { id: req.params.id }, data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "update_redirect",
      entityType: "Redirect",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  res.json(after);
});

// --- Admin: sources management (spec §5, MANAGE_SOURCES-gated) ---

// Real gap found and fixed 2026-09-07: `PATCH /v1/sources/:id` (below)
// has let an editor correct an *existing* source's trust score/active/
// crawlInterval since early in this project, but nothing ever let one
// add a brand-new source — the only way any of the 3 real sources this
// project has ever ingested came into existence is `seed.ts`. Same
// "manual DB write required" gap already fixed for Facts/Redirects/
// Users, just not yet applied to the one entity this whole ingestion
// pipeline is actually built around.
// Real gap found and fixed 2026-09-07: neither field checked it was
// actually a well-formed URL — verified live that a malformed
// `feedUrl` reaching `apps/worker`'s crawler causes an uncaught
// rejection in `checkRobotsAllowed()` (see that file's own fix),
// wasting real BullMQ retry attempts on a URL that can never succeed
// instead of failing fast at the one place a human enters this data.
const createSourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().min(1).url(),
  feedUrl: z.string().min(1).url().optional(),
  type: z.enum([
    "RSS",
    "ATOM",
    "OFFICIAL_API",
    "MANUFACTURER_PRESS_ROOM",
    "GOVERNMENT",
    "REGULATORY",
    "FINANCIAL_FILING",
    "NEWS_MEDIA",
    "SOCIAL",
    "OTHER",
  ]),
  tier: z.enum(["PRIMARY", "WIRE", "SPECIALIST", "REGIONAL", "SOCIAL_LEAD", "UNVERIFIED"]).optional(),
  trustScore: z.number().int().min(0).max(100).optional(),
  crawlInterval: z.number().int().min(60).optional(),
});

app.post("/v1/sources", requirePermission("MANAGE_SOURCES"), async (req, res) => {
  const parsed = createSourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const existing = await prisma.source.findUnique({ where: { url: parsed.data.url } });
  if (existing) {
    res.status(409).json({ error: "url_taken" });
    return;
  }

  const source = await prisma.source.create({ data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "create_source",
      entityType: "Source",
      entityId: source.id,
      after: source as unknown as object,
    },
  });

  res.status(201).json(source);
});

const updateSourceSchema = z.object({
  active: z.boolean().optional(),
  trustScore: z.number().int().min(0).max(100).optional(),
  crawlInterval: z.number().int().min(60).optional(),
});

app.patch("/v1/sources/:id", requirePermission("MANAGE_SOURCES"), async (req, res) => {
  const parsed = updateSourceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const before = await prisma.source.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const after = await prisma.source.update({ where: { id: req.params.id }, data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "update_source",
      entityType: "Source",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  // Real gap found and fixed 2026-09-07: docs/editorial-system.md
  // documents `SourceScoreEvent` (append-only) as how a source's
  // trustScore "moves" over time — it existed since the schema scaffold
  // with zero write sites anywhere. The algorithmic version described
  // there (a source earning/losing score based on real corroboration/
  // contradiction) genuinely needs a research/fact-checking AI stage
  // that doesn't exist yet — correctly not invented here. But a human
  // editor correcting trustScore through this exact endpoint is a real,
  // already-happening way the score moves today, and the table's own
  // shape (a generic `reason` string, not an enum tied to the AI
  // pipeline) accommodates that without contradicting its documented
  // future use — this is additive, not a stand-in for the real thing.
  if (parsed.data.trustScore !== undefined && after.trustScore !== before.trustScore) {
    await prisma.sourceScoreEvent.create({
      data: {
        sourceId: after.id,
        delta: after.trustScore - before.trustScore,
        newScore: after.trustScore,
        reason: `Manually corrected by ${await auditActorLabel(req.userId)}`,
      },
    });
  }

  res.json(after);
});

// Real gap found and fixed 2026-09-07 (see PATCH /v1/sources/:id above):
// public read, matching GET /v1/sources's own "public read surface"
// precedent — a reader/editor can now actually see why a source's trust
// score is what it is, not just its current number.
app.get("/v1/sources/:id/score-events", async (req, res) => {
  const source = await prisma.source.findUnique({ where: { id: req.params.id } });
  if (!source) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const events = await prisma.sourceScoreEvent.findMany({
    where: { sourceId: req.params.id },
    orderBy: { createdAt: "desc" },
  });
  res.json({ events });
});

// --- Admin: user management (spec §40 RBAC, MANAGE_USERS-gated) ---
//
// Real gap found and fixed 2026-09-07: `PermissionKey.MANAGE_USERS`
// already existed and was granted to admin, but no endpoint ever checked
// it — the only way any User row ever came to exist was seed.ts's single
// hardcoded `admin@dev.local`. There was no way to add a second admin or
// an editor account without a manual DB write. Same pattern as the
// VIEW_AUDIT_LOG gap found earlier the same day.

app.get("/v1/roles", requirePermission("MANAGE_USERS"), async (_req, res) => {
  const roles = await prisma.role.findMany({ select: { key: true, name: true }, orderBy: { key: "asc" } });
  res.json({ roles });
});

app.get("/v1/users", requirePermission("MANAGE_USERS"), async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      createdAt: true,
      roles: { select: { role: { select: { key: true } } } },
    },
  });
  res.json({
    users: users.map(({ roles, ...u }) => ({ ...u, roles: roles.map((r) => r.role.key) })),
  });
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  roleKey: z.string().min(1),
});

app.post("/v1/users", requirePermission("MANAGE_USERS"), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const role = await prisma.role.findUnique({ where: { key: parsed.data.roleKey } });
  if (!role) {
    res.status(400).json({ error: "unknown_role" });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    res.status(409).json({ error: "email_taken" });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash,
      status: "ACTIVE",
      roles: { create: { roleId: role.id } },
    },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "create_user",
      entityType: "User",
      entityId: user.id,
      after: { email: user.email, name: user.name, status: user.status, roleKey: role.key } as object,
    },
  });

  res.status(201).json({ id: user.id, email: user.email, name: user.name, status: user.status, roles: [role.key] });
});

const updateUserStatusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });

app.patch("/v1/users/:id/status", requirePermission("MANAGE_USERS"), async (req, res) => {
  const parsed = updateUserStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  // A real lockout risk, not a hypothetical one: without this guard, the
  // only seeded admin could suspend their own only account with no DB
  // access to undo it. Every other admin action in this app can be
  // reversed through the UI itself; this is the one that couldn't be.
  if (req.params.id === req.userId && parsed.data.status === "SUSPENDED") {
    res.status(400).json({ error: "cannot_suspend_self" });
    return;
  }

  const before = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const after = await prisma.user.update({ where: { id: req.params.id }, data: { status: parsed.data.status } });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "update_user_status",
      entityType: "User",
      entityId: after.id,
      before: { status: before.status } as object,
      after: { status: after.status } as object,
    },
  });

  res.json({ id: after.id, status: after.status });
});

// --- Admin: brand/car model creation (spec §24, UPDATE_CAR-gated) ---
//
// Real gap found and fixed 2026-09-07: the fact-correction endpoints
// below let an editor add/correct a Fact on an *existing* CarModel, but
// nothing anywhere let one create a new Brand or CarModel at all — every
// one of them, in the entire real database, exists only because
// `seed.ts` wrote it directly. The exact same "manual DB write required"
// gap already fixed today for Sources/Facts/Redirects/Users, just not
// yet applied to the two entities this platform's actual Knowledge Graph
// is built around. Reuses `UPDATE_CAR` (no dedicated `PermissionKey` for
// brand/model management specifically, same reasoning already used for
// reusing `MANAGE_SYSTEM_SETTINGS` on `/v1/redirects` — avoid a schema
// migration for one small CMS feature).

app.get("/v1/brands", async (_req, res) => {
  const brands = await prisma.brand.findMany({ orderBy: { name: "asc" } });
  res.json({ brands });
});

// Real gap found and fixed 2026-09-07: every slug field below (Brand,
// CarModel, Generation, Trim) accepted any string at all — no case or
// character restriction, unlike every real seeded slug in this project
// (`bmw`, `3-series`, ...), which is lowercase-kebab-case by convention
// only, never enforced. Slugs feed real, indexable URLs (`/cars/:brand/
// :model`), so this is a genuine SEO/duplicate-content risk, not just a
// cosmetic one: `Brand.slug` is a case-SENSITIVE `@unique` Postgres
// column, so an admin typing "BMW" into the real "Add brand" form
// (which only shows a lowercase example in its placeholder, nothing
// enforcing it) would create a second, visually-near-identical brand
// rather than conflicting with the real existing "bmw" — a real,
// same-day-pattern data-entry mistake (see the Generation startYear/
// endYear and formatCountryName casing fixes) reaching a real,
// search-engine-visible URL instead of just a display string.
const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be lowercase letters, numbers, and hyphens only (e.g. \"3-series\")");

const createBrandSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  country: z.string().optional(),
});

app.post("/v1/brands", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = createBrandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const existing = await prisma.brand.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) {
    res.status(409).json({ error: "slug_taken" });
    return;
  }

  const brand = await prisma.brand.create({ data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "create_brand",
      entityType: "Brand",
      entityId: brand.id,
      after: brand as unknown as object,
    },
  });

  res.status(201).json(brand);
});

const createCarModelSchema = z.object({
  brandSlug: z.string().min(1),
  slug: slugSchema,
  name: z.string().min(1),
});

app.post("/v1/cars", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = createCarModelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const brand = await prisma.brand.findUnique({ where: { slug: parsed.data.brandSlug } });
  if (!brand) {
    res.status(404).json({ error: "brand_not_found" });
    return;
  }

  const existing = await prisma.carModel.findUnique({
    where: { brandId_slug: { brandId: brand.id, slug: parsed.data.slug } },
  });
  if (existing) {
    res.status(409).json({ error: "slug_taken" });
    return;
  }

  const carModel = await prisma.carModel.create({
    data: { brandId: brand.id, slug: parsed.data.slug, name: parsed.data.name },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "create_car_model",
      entityType: "CarModel",
      entityId: carModel.id,
      after: carModel as unknown as object,
    },
  });

  res.status(201).json(carModel);
});

// Real gap found and fixed 2026-09-07 (same day, later pass): every
// other admin entity built today (Source, Fact, Redirect, User) got
// both a create AND a correct path — Brand/CarModel only ever got
// create. Once a real typo is made through the "Add brand"/"Add car
// model" forms above, there was no way to fix it short of a manual DB
// write, the exact same class of gap this whole day has been closing.
const updateBrandSchema = z.object({
  name: z.string().min(1).optional(),
  country: z.string().optional(),
});

app.patch("/v1/brands/:id", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = updateBrandSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const before = await prisma.brand.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const after = await prisma.brand.update({ where: { id: req.params.id }, data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "update_brand",
      entityType: "Brand",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  res.json(after);
});

const updateCarModelSchema = z.object({
  name: z.string().min(1),
});

// Addressed by brandSlug/modelSlug (matching GET /v1/cars/:brandSlug/
// :modelSlug and the facts/generations sub-routes for this same
// CarModel), not a raw id — CarModel already has an established
// slug-based addressing scheme, unlike Generation/Trim/Engine/Battery
// (which have no public SEO-facing URL and are addressed by id).
app.patch("/v1/cars/:brandSlug/:modelSlug", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = updateCarModelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const before = await prisma.carModel.findFirst({
    where: { slug: req.params.modelSlug, brand: { slug: req.params.brandSlug } },
  });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const after = await prisma.carModel.update({ where: { id: before.id }, data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "update_car_model",
      entityType: "CarModel",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  res.json(after);
});

// Real gap found and fixed 2026-09-07: `POST /v1/cars` (above) lets an
// editor create a brand-new CarModel, but the real structured hierarchy
// the car page actually displays most prominently (Generation → Trim →
// Engine/Battery) had no create path at all — a freshly-created CarModel
// could only ever gain flat Facts, never a real generation/trim to
// describe it properly. Scoped deliberately to Generation + Trim only
// this pass (a Trim already renders meaningfully with zero engines,
// same "doesn't need every child row" reasoning as CarModel/Source) —
// Engine/Battery creation is a natural, separate follow-up.
// Real gap found and fixed 2026-09-07 (validation consistency): the
// numeric fields below (and on createEngineSchema/createBatterySchema)
// accepted any number, including negative — inconsistent with this
// file's own established convention for physically-bounded values
// (createSourceSchema's trustScore: min(0).max(100), crawlInterval:
// min(60)). A negative year/power/capacity/range can never be real
// data, so bounding it here is catching a genuine input error, not
// being arbitrarily strict.
// Real gap found and fixed 2026-09-07: neither this schema nor the
// update one below ever checked `endYear` against `startYear` — a car
// page renders this pair literally as `{startYear}–{endYear}` (see
// apps/web/src/app/cars/[brand]/[model]/page.tsx), so a data-entry
// mistake (e.g. the two fields swapped) would publish a nonsensical
// range like "2024–1990" on a real public page with nothing anywhere
// catching it.
const createGenerationSchema = z
  .object({
    slug: slugSchema,
    name: z.string().min(1),
    startYear: z.number().int().positive().optional(),
    endYear: z.number().int().positive().optional(),
  })
  .refine((data) => data.startYear == null || data.endYear == null || data.endYear >= data.startYear, {
    message: "endYear must not be before startYear",
    path: ["endYear"],
  });

app.post("/v1/cars/:brandSlug/:modelSlug/generations", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = createGenerationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const carModel = await prisma.carModel.findFirst({
    where: { slug: req.params.modelSlug, brand: { slug: req.params.brandSlug } },
  });
  if (!carModel) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const existing = await prisma.generation.findUnique({
    where: { carModelId_slug: { carModelId: carModel.id, slug: parsed.data.slug } },
  });
  if (existing) {
    res.status(409).json({ error: "slug_taken" });
    return;
  }

  const generation = await prisma.generation.create({ data: { carModelId: carModel.id, ...parsed.data } });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "create_generation",
      entityType: "Generation",
      entityId: generation.id,
      after: generation as unknown as object,
    },
  });

  res.status(201).json(generation);
});

const createTrimSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
});

app.post("/v1/generations/:generationId/trims", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = createTrimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const generation = await prisma.generation.findUnique({ where: { id: req.params.generationId } });
  if (!generation) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const existing = await prisma.trim.findUnique({
    where: { generationId_slug: { generationId: generation.id, slug: parsed.data.slug } },
  });
  if (existing) {
    res.status(409).json({ error: "slug_taken" });
    return;
  }

  const trim = await prisma.trim.create({ data: { generationId: generation.id, ...parsed.data } });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "create_trim",
      entityType: "Trim",
      entityId: trim.id,
      after: trim as unknown as object,
    },
  });

  res.status(201).json(trim);
});

// Real gap found and fixed 2026-09-07: the last real gap in this
// hierarchy — POST /v1/generations/:generationId/trims (above) lets an
// editor add a Trim, but Engine/Battery (the two leaf entities the car
// page's own EV/ICE spec display is actually built from) had no create
// path at all, flagged as the deliberate next step when Generation/Trim
// creation was scoped down earlier the same day. Neither model has a
// unique constraint (verified in the schema, not assumed) — no 409 case
// exists for either.
const createEngineSchema = z.object({
  name: z.string().min(1),
  powerKw: z.number().positive().optional(),
  powerHp: z.number().positive().optional(),
  fuel: z.string().optional(),
});

app.post("/v1/trims/:trimId/engines", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = createEngineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const trim = await prisma.trim.findUnique({ where: { id: req.params.trimId } });
  if (!trim) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const engine = await prisma.engine.create({ data: { trimId: trim.id, ...parsed.data } });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "create_engine",
      entityType: "Engine",
      entityId: engine.id,
      after: engine as unknown as object,
    },
  });

  res.status(201).json(engine);
});

const createBatterySchema = z.object({
  capacityKwh: z.number().positive().optional(),
  rangeKm: z.number().positive().optional(),
  rangeMiles: z.number().positive().optional(),
});

app.post("/v1/trims/:trimId/batteries", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = createBatterySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const trim = await prisma.trim.findUnique({ where: { id: req.params.trimId } });
  if (!trim) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const battery = await prisma.battery.create({ data: { trimId: trim.id, ...parsed.data } });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "create_battery",
      entityType: "Battery",
      entityId: battery.id,
      after: battery as unknown as object,
    },
  });

  res.status(201).json(battery);
});

// Real gap found and fixed 2026-09-07 (same day, later pass): the same
// class of gap just closed for Brand/CarModel — Generation/Trim/Engine/
// Battery all got a create path but never a correct one. All four
// addressed by real id (none has a public SEO-facing URL, matching the
// same reasoning already applied to their own POST routes).
const updateGenerationSchema = z.object({
  name: z.string().min(1).optional(),
  startYear: z.number().int().positive().optional(),
  endYear: z.number().int().positive().optional(),
});

app.patch("/v1/generations/:id", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = updateGenerationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const before = await prisma.generation.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // A PATCH can legitimately touch only one of the two fields — the
  // create schema's own endYear>=startYear refine only sees the request
  // body, not the row's existing values, so a correction that only
  // changes one field needs its own check against the *effective*
  // merged result, not just what's newly submitted.
  const effectiveStartYear = parsed.data.startYear ?? before.startYear;
  const effectiveEndYear = parsed.data.endYear ?? before.endYear;
  if (effectiveStartYear != null && effectiveEndYear != null && effectiveEndYear < effectiveStartYear) {
    res.status(400).json({ error: "invalid_body", issues: [{ message: "endYear must not be before startYear" }] });
    return;
  }

  const after = await prisma.generation.update({ where: { id: req.params.id }, data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "update_generation",
      entityType: "Generation",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  res.json(after);
});

const updateTrimSchema = z.object({
  name: z.string().min(1),
});

app.patch("/v1/trims/:id", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = updateTrimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const before = await prisma.trim.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const after = await prisma.trim.update({ where: { id: req.params.id }, data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "update_trim",
      entityType: "Trim",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  res.json(after);
});

const updateEngineSchema = z.object({
  name: z.string().min(1).optional(),
  powerKw: z.number().positive().optional(),
  powerHp: z.number().positive().optional(),
  fuel: z.string().optional(),
});

app.patch("/v1/engines/:id", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = updateEngineSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const before = await prisma.engine.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const after = await prisma.engine.update({ where: { id: req.params.id }, data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "update_engine",
      entityType: "Engine",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  res.json(after);
});

const updateBatterySchema = z.object({
  capacityKwh: z.number().positive().optional(),
  rangeKm: z.number().positive().optional(),
  rangeMiles: z.number().positive().optional(),
});

app.patch("/v1/batteries/:id", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = updateBatterySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const before = await prisma.battery.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const after = await prisma.battery.update({ where: { id: req.params.id }, data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "update_battery",
      entityType: "Battery",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  res.json(after);
});

// --- Admin: car fact correction (spec §24/§90-91, UPDATE_CAR-gated) ---
//
// Real gap found and fixed 2026-09-07: `PermissionKey.UPDATE_CAR`
// already existed and admin already had it granted, but no endpoint ever
// checked it — every `Fact` row in this database exists only because
// `seed.ts` or `ingestSource()` wrote it directly; there was no way for a
// human editor to correct a wrong spec/price or add a new one without a
// manual DB write, even though the whole time/market-aware Fact system
// (spec §90-91) exists specifically to let facts change over time.

const createFactSchema = z.object({
  attribute: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().optional(),
  marketId: z.string().optional(),
});

app.post("/v1/cars/:brandSlug/:modelSlug/facts", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = createFactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const carModel = await prisma.carModel.findFirst({
    where: { slug: req.params.modelSlug, brand: { slug: req.params.brandSlug } },
  });
  if (!carModel) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // Real gap found and fixed 2026-09-08, same pass as the
  // express-async-errors fix above: unlike every other parent reference
  // in this file (Brand for CarModel, CarModel/Brand for this very
  // endpoint just above), `marketId` was never checked to actually
  // reference a real Market row before being handed to `.create()` — a
  // bad id reached Prisma raw and, before the fix above, crashed the
  // whole process instead of failing cleanly for just this one request.
  if (parsed.data.marketId) {
    const market = await prisma.market.findUnique({ where: { id: parsed.data.marketId } });
    if (!market) {
      res.status(404).json({ error: "market_not_found" });
      return;
    }
  }

  // CONFIRMED + max confidence: a human editor directly asserting a
  // value is a stronger claim than anything the crawler/AI stand-ins
  // write today (those default to REPORTED/lower confidence — see
  // ingest.ts), not an arbitrary default.
  const fact = await prisma.fact.create({
    data: {
      carModelId: carModel.id,
      attribute: parsed.data.attribute,
      value: parsed.data.value,
      unit: parsed.data.unit,
      marketId: parsed.data.marketId,
      status: "CONFIRMED",
      confidence: 1,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "create_fact",
      entityType: "Fact",
      entityId: fact.id,
      after: fact as unknown as object,
    },
  });

  res.status(201).json(fact);
});

const updateFactSchema = z.object({
  value: z.string().min(1),
  unit: z.string().optional(),
});

app.patch("/v1/facts/:id", requirePermission("UPDATE_CAR"), async (req, res) => {
  const parsed = updateFactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const before = await prisma.fact.findUnique({ where: { id: req.params.id } });
  if (!before) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const after = await prisma.fact.update({ where: { id: req.params.id }, data: parsed.data });

  await prisma.auditLog.create({
    data: {
      actorType: "HUMAN",
      actorLabel: await auditActorLabel(req.userId),
      actorUserId: req.userId,
      action: "update_fact",
      entityType: "Fact",
      entityId: after.id,
      before: before as unknown as object,
      after: after as unknown as object,
    },
  });

  res.json(after);
});

// --- Fallthrough error handling ---
//
// Real gap found and fixed 2026-09-07: this app had no catch-all 404 and
// no error-handling middleware anywhere, so anything that fell through
// every route above hit Express's own defaults instead of this API's
// established JSON error contract (`{error: "..."}`, used by every route
// above). Confirmed live before fixing, not assumed: an unmatched route
// returned Express's default HTML 404 page, and a malformed JSON request
// body (a real, attacker-triggerable input, not a contrived case) hit
// Express's default error handler, which returned an HTML page
// containing a full stack trace WITH real absolute server filesystem
// paths (`C:\...\node_modules\body-parser\...`) — a genuine information
// disclosure, not a cosmetic issue, in the same "real security gap found
// and fixed same day" category as the qs CVE mitigation and the missing
// security headers above.
//
// The 404 handler must be registered after every real route (Express
// matches routes in registration order) but the error handler must be
// last of all (Express recognizes it as an error handler specifically by
// its 4-argument signature — dropping any one of the four parameters,
// even an unused `next`, changes its meaning to a regular middleware
// that never runs on error).
app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // body-parser's own error shape for invalid JSON — the one real,
  // client-triggerable case verified live above. Everything else is
  // treated as an unexpected server error: logged with the real stack
  // server-side (so it's still debuggable), never echoed to the client.
  const isBadJson = err instanceof SyntaxError && "type" in err && err.type === "entity.parse.failed";
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), correlationId: req.correlationId, error: String(err) }));
  res.status(isBadJson ? 400 : 500).json({ error: isBadJson ? "invalid_json" : "internal_error" });
});
