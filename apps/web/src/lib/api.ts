// Server-side only fetch helper. Every call here runs in a Server
// Component/route handler, never in the browser — apps/web ships close to
// zero client JS (spec §63 "not a huge client-side application").
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
// Real gap found and fixed 2026-09-07: none of the fetches in this file
// had a timeout — every public page's Server Component render calls one
// of these, so a hung apps/api would hang the corresponding page load
// indefinitely rather than reaching apps/web's own error.tsx (added
// earlier the same day), which only catches a thrown error, not a
// pending promise that never resolves. Same reasoning/value as
// apps/proxy.ts's own fix and apps/worker's earlier fetch-timeout fix.
const API_FETCH_TIMEOUT_MS = 10_000;
// Real live verification, 2026-09-08 (this fix had never actually been
// tested against a genuinely hung upstream before — only code-reviewed):
// booted a real Node HTTP server on port 4000 that accepts a connection
// but never responds, pointed a real `next build && next start` (and,
// separately, real `next dev`) at it as `API_INTERNAL_URL`, and curled
// the homepage and the car page. Both correctly resolve — never hang
// forever — but both took **~20 seconds**, not the ~10s this constant's
// name might suggest, reproduced identically in dev and production
// builds. Root cause fully pinned down by inspecting a logging version
// of the fake upstream's own request timestamps, then confirmed by
// reading the real code: `apps/proxy.ts` runs on EVERY matched request
// BEFORE the page even starts rendering, and it makes its OWN
// `/v1/redirects/lookup` fetch with its own independent
// `AbortSignal.timeout(API_FETCH_TIMEOUT_MS)` — that call alone eats a
// full 10s when apps/api is hung, swallowed by proxy.ts's own try/catch
// ("a redirect lookup failure must never break normal navigation"),
// only THEN does `NextResponse.next()` let the actual page's own
// `getCarModel()`/`getStories()`/etc. fetch begin, paying this file's
// same 10s timeout a second time. Two independent, architecturally
// sequential 10s timeouts (proxy.ts's redirect check, then this file's
// own page-data fetch) is the real, complete explanation — not a
// mysterious Next.js retry (an earlier pass at this same finding
// guessed that, before capturing the fake upstream's own request log
// disproved it). Treat this constant as roughly HALF the real
// worst-case page-load latency during a full apps/api outage (add
// `proxy.ts`'s own timeout on top), not the ceiling itself. Still a
// large, correct improvement over the original bug (an unbounded hang),
// and the response body was confirmed to leak no stack trace/
// filesystem path either way.

export interface StorySummary {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  importanceScore: number;
  firstSeenAt: string;
  lastUpdatedAt: string;
  _count: { sourceArticles: number };
  sources: { source: { name: string; trustScore: number } }[];
  primaryTopic: { slug: string; name: string } | null;
  events: { id: string; label: string; description: string | null; occurredAt: string }[];
  sourceArticles: { id: string; title: string; url: string; author: { name: string } | null }[];
  articles: { slug: string; locale: string; images: { altText: string | null; image: { originalUrl: string; rightsStatus: string; width: number | null; height: number | null } }[] }[];
}

export interface SourceSummary {
  id: string;
  name: string;
  url: string;
  type: string;
  tier: string;
  trustScore: number;
  active: boolean;
  crawlInterval: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  robotsStatus: string | null;
}

export interface SourceScoreEvent {
  id: string;
  delta: number;
  newScore: number;
  reason: string;
  createdAt: string;
}

// Real gap found and fixed 2026-09-07: docs/editorial-system.md
// documents SourceScoreEvent as how a source's trustScore "moves" over
// time, but nothing wrote to it — PATCH /v1/sources/:id now writes one
// on every real trustScore correction, and this reads it back.
export function getSourceScoreEvents(sourceId: string): Promise<{ events: SourceScoreEvent[] }> {
  return apiGet(`/v1/sources/${sourceId}/score-events`);
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_INTERNAL_URL}${path}`, {
    // No caching yet — real ISR revalidation windows come with real
    // publishing cadence (docs/architecture.md); for now always fresh so
    // this proves live data, not a stale build-time snapshot.
    cache: "no-store",
    signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`API ${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Real gap found and fixed 2026-09-07: this never accepted an offset —
// with 150+ real Stories in the DB and /admin/stories always calling
// this with a fixed limit, every Story older than the most recent page
// was permanently unreachable through the admin UI.
export function getStories(
  // `hasArticle` added 2026-09-09, user's explicit request: the reader-
  // facing homepage passes this (see its own page.tsx) so its "Latest"
  // feed only ever shows Stories with a real published Article behind
  // them — /admin/stories deliberately never passes it, since an
  // editor's whole job there is seeing every Story, written or not.
  params: { status?: string; limit?: number; offset?: number; hasArticle?: boolean } = {},
): Promise<{ stories: StorySummary[]; hasMore: boolean; offset: number; limit: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.hasArticle) qs.set("hasArticle", "true");
  const suffix = qs.toString() ? `?${qs}` : "";
  return apiGet(`/v1/stories${suffix}`);
}

export function getSources(): Promise<{ sources: SourceSummary[] }> {
  return apiGet("/v1/sources");
}

export interface CarEngine {
  id: string;
  name: string;
  powerHp: number | null;
  powerKw: number | null;
  fuel: string | null;
}

export interface CarTrim {
  id: string;
  name: string;
  engines: CarEngine[];
  batteries: { id: string; capacityKwh: number | null; rangeKm: number | null; rangeMiles: number | null }[];
}

export interface CarGeneration {
  id: string;
  name: string;
  startYear: number | null;
  endYear: number | null;
  trims: CarTrim[];
}

export interface CarFact {
  id: string;
  attribute: string;
  value: string;
  unit: string | null;
  status: string;
  market: { code: string; name: string } | null;
}

export interface CarVideo {
  id: string;
  youtubeId: string;
  title: string;
  category: "OFFICIAL" | "CRASH_TEST" | "REVIEW";
}

export interface CarModelImage {
  id: string;
  role: "HERO" | "INLINE" | "GALLERY" | "OG";
  altText: string | null;
  // Added 2026-09-14 alongside the schema column of the same name: lets
  // the car model page show a photo inside the specific Generation
  // section it belongs to, instead of every photo landing in one
  // undifferentiated gallery with no visible link to which generation
  // is which. `null` means a model-level photo (most HERO images).
  generationId: string | null;
  image: { originalUrl: string; attribution: string | null; width: number | null; height: number | null };
}

export interface CrashTestResult {
  id: string;
  organization: "EURO_NCAP" | "IIHS" | "NHTSA";
  overallRating: string;
  categoryScores: Record<string, string> | null;
  testYear: number;
  sourceUrl: string;
  video: { id: string; youtubeId: string; title: string } | null;
}

// Real gap found and fixed 2026-09-11: ArticleCarModel has real rows
// for every COMPARISON/ANALYSIS piece that explicitly names this
// model, but nothing on the car page ever surfaced them — confirmed
// live that /cars/bmw/x5 had zero link to the real comparison article
// written specifically about it.
export interface FeaturedArticle {
  slug: string;
  locale: string;
  headline: string;
  type: string;
  publishedAt: string | null;
}

export interface CarModelDetail {
  id: string;
  slug: string;
  name: string;
  catalogReviewedAt: string | null;
  brand: { id: string; slug: string; name: string; country: string | null };
  generations: CarGeneration[];
  facts: CarFact[];
  videos: CarVideo[];
  images: CarModelImage[];
  crashTests: CrashTestResult[];
  featuredArticles: FeaturedArticle[];
}

export interface SearchResults {
  stories: { id: string; title: string; articleSlug: string | null }[];
  carModels: { brandSlug: string; modelSlug: string; name: string }[];
}

export function search(q: string): Promise<SearchResults> {
  return apiGet(`/v1/search?q=${encodeURIComponent(q)}`);
}

// `lastModified` added 2026-09-08 (real gap: sitemap.ts never set it —
// see its own comment) — the real `GET /v1/cars`/`GET /v1/topics`
// endpoints' own most-recent-timestamp signal, `null` when nothing real
// backs it yet (a car with no Fact, a topic with no Story).
export function getCarModelSlugs(): Promise<{
  carModels: { brandSlug: string; modelSlug: string; lastModified: string | null }[];
}> {
  return apiGet("/v1/cars");
}

export function getTopicSlugs(): Promise<{ topics: { slug: string; lastModified: string | null }[] }> {
  return apiGet("/v1/topics");
}

// Real gap found and fixed 2026-09-09 — see sitemap.ts's own comment:
// real published Articles were entirely missing from the sitemap.
export function getArticleSlugs(): Promise<{
  articles: { locale: string; slug: string; publishedAt: string | null; updatedAt: string }[];
}> {
  return apiGet("/v1/articles");
}

// Backs /news-sitemap.xml — see GET /v1/news-sitemap-articles's own
// comment for why this is a separate feed from getArticleSlugs above
// (NEWS/BREAKING_NEWS only, last 48 hours only, carries a real headline
// for <news:title>).
export function getNewsSitemapArticles(): Promise<{
  articles: { locale: string; slug: string; headline: string; publishedAt: string | null }[];
}> {
  return apiGet("/v1/news-sitemap-articles");
}

export interface GuideSummary {
  locale: string;
  slug: string;
  headline: string;
  subtitle: string | null;
  publishedAt: string | null;
  updatedAt: string;
  images: { altText: string | null; image: { originalUrl: string; rightsStatus: string; width: number | null; height: number | null } }[];
}

// New /guides section (2026-09-11) — user's own pick from the vertical-
// slice AskUserQuestion ("Новый раздел /guides (Recommended)") for where
// GUIDE-type evergreen content should live.
export function getGuides(): Promise<{ guides: GuideSummary[] }> {
  return apiGet("/v1/guides");
}

// Homepage portal restructuring (2026-09-11) — user's own explicit
// request: "не как новостная лента, а ... портал". Backs the "Comparisons
// & Analysis" section, mirroring GET /v1/guides's own shape/pattern —
// see GET /v1/featured-articles's own comment in apps/api for why this
// is a separate endpoint from /v1/guides rather than widening it.
export interface FeaturedArticleSummary {
  locale: string;
  slug: string;
  headline: string;
  subtitle: string | null;
  type: "COMPARISON" | "ANALYSIS";
  publishedAt: string | null;
  images: { altText: string | null; image: { originalUrl: string; rightsStatus: string; width: number | null; height: number | null } }[];
}

export function getFeaturedArticles(): Promise<{ articles: FeaturedArticleSummary[] }> {
  return apiGet("/v1/featured-articles");
}

// Backs the homepage's "Explore models" visual grid — see GET
// /v1/featured-cars's own comment for why only models with a real HERO
// photo are ever returned (no placeholder tiles for a model with no
// photo yet).
export interface FeaturedCar {
  brandSlug: string;
  brandName: string;
  modelSlug: string;
  modelName: string;
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
}

export function getFeaturedCars(): Promise<{ carModels: FeaturedCar[] }> {
  return apiGet("/v1/featured-cars");
}

export interface Market {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  unitSystem: string;
}

// Real gap found and fixed 2026-09-07: real Market rows have existed
// since seed.ts's original scaffold, and POST .../facts has accepted an
// optional marketId since that endpoint was built — but /admin/cars had
// no way to read the market list back to offer a picker in its "Add
// fact" form, so every editor-added Fact was silently global.
export function getMarkets(): Promise<{ markets: Market[] }> {
  return apiGet("/v1/markets");
}

export interface Brand {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  contentCount: number;
  reviewedModelCount: number;
}

// Real gap found and fixed 2026-09-07: every real Brand/CarModel in this
// DB exists only because seed.ts wrote it — nothing ever let an editor
// add a new one. This reads the real brand list back so /admin/cars's
// new "Add car model" form can offer a brand picker.
export function getBrands(): Promise<{ brands: Brand[] }> {
  return apiGet("/v1/brands");
}

// `articleSlug` added 2026-09-11 (real gap: the car page rendered every
// related story as plain, unlinked text even when a real published EN
// article existed for it) — `null` when the Story hasn't been written up
// yet, a real valid state the page must still handle.
export interface RelatedStorySummary {
  id: string;
  title: string;
  articleSlug: string | null;
}

export interface CarModelWithRelated {
  carModel: CarModelDetail;
  relatedStories: RelatedStorySummary[];
}

export async function getCarModel(brandSlug: string, modelSlug: string): Promise<CarModelWithRelated | null> {
  const res = await fetch(`${API_INTERNAL_URL}/v1/cars/${brandSlug}/${modelSlug}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API /v1/cars/${brandSlug}/${modelSlug} returned ${res.status}`);
  return res.json();
}

// Added 2026-09-16 alongside GET /v1/compare — see that endpoint's own
// comment for why this is a separate lean shape rather than reusing
// CarModelDetail (which carries related-stories/articles/every historical
// generation a comparison view never shows).
export interface CompareCar {
  brandSlug: string;
  brandName: string;
  modelSlug: string;
  modelName: string;
  heroImageUrl: string | null;
  heroImageWidth: number | null;
  heroImageHeight: number | null;
  generation: {
    name: string;
    startYear: number | null;
    endYear: number | null;
    trims: { name: string; engineName: string | null; fuel: string | null }[];
  } | null;
  facts: { attribute: string; value: string; unit: string | null }[];
}

export async function getCompare(aBrand: string, aModel: string, bBrand: string, bModel: string): Promise<{ cars: [CompareCar, CompareCar] } | null> {
  const qs = new URLSearchParams({ aBrand, aModel, bBrand, bModel });
  const res = await fetch(`${API_INTERNAL_URL}/v1/compare?${qs}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API /v1/compare returned ${res.status}`);
  return res.json();
}

export interface BrandDetail {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  models: { slug: string; name: string; imageUrl: string | null; imageWidth: number | null; imageHeight: number | null }[];
}

export interface BrandRelatedArticle {
  slug: string;
  headline: string;
  subtitle: string | null;
  type: string;
}

export interface BrandWithRelated {
  brand: BrandDetail;
  relatedArticles: BrandRelatedArticle[];
  relatedStories: RelatedStorySummary[];
}

// Real brand hub page (vertical-slice plan, 2026-09-11): same shape and
// same no-store/timeout/404-as-null contract as getCarModel()/getTopic()
// above, for consistency across every real detail-page fetch in this file.
export async function getBrand(slug: string): Promise<BrandWithRelated | null> {
  const res = await fetch(`${API_INTERNAL_URL}/v1/brands/${slug}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API /v1/brands/${slug} returned ${res.status}`);
  return res.json();
}

// Evergreen Articles tagged directly with this Topic (no Story) — see
// GET /v1/topics/:slug's own comment for why this exists alongside
// `stories` rather than being folded into it.
export interface TopicArticleSummary {
  slug: string;
  headline: string;
  subtitle: string | null;
  type: string;
  publishedAt: string | null;
  images: { altText: string | null; image: { originalUrl: string; rightsStatus: string; width: number | null; height: number | null } }[];
}

export interface TopicWithStories {
  topic: { id: string; slug: string; name: string };
  stories: StorySummary[];
  articles: TopicArticleSummary[];
}

export async function getTopic(slug: string): Promise<TopicWithStories | null> {
  const res = await fetch(`${API_INTERNAL_URL}/v1/topics/${slug}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API /v1/topics/${slug} returned ${res.status}`);
  return res.json();
}

// `data`'s real shape depends on `type` (packages/database/prisma/
// schema.prisma's ArticleBlock.data comment says exactly this — "shape
// depends on type; validated at write time, not by the DB"). TEXT was
// the only real shape until SPEC_TABLE landed 2026-09-11 alongside its
// first real renderer — see that page's own comment for why a
// structured comparison table couldn't just be written before then.
// VIDEO added 2026-09-16 (youtubeId/title/label — the same props
// CinematicVideo.tsx itself takes) alongside its own renderer.
export interface ArticleBlock {
  id: string;
  type: string;
  position: number;
  data: { text?: string; headers?: string[]; rows?: { label: string; values: string[] }[]; youtubeId?: string; title?: string; label?: string };
}

export interface ArticleHeroImage {
  role: "HERO" | "GALLERY";
  altText: string | null;
  image: { originalUrl: string; attribution: string | null; width: number | null; height: number | null };
}

export interface ArticleCitation {
  id: string;
  label: string;
  url: string;
}

export interface ArticleRelatedCarModelVideo {
  title: string;
  category: "OFFICIAL" | "CRASH_TEST" | "REVIEW";
  youtubeId: string;
}

export interface ArticleRelatedCarModel {
  carModel: { slug: string; name: string; brand: { slug: string; name: string }; videos: ArticleRelatedCarModelVideo[] };
}

// Real gap found and fixed 2026-09-11 — backed by a real EntityRelation
// edge (see GET /v1/articles/:locale/:slug's own comment): several of
// this site's own COMPARISON/ANALYSIS/GUIDE articles reference each
// other in prose ("see this site's own analysis of..."), but TEXT
// blocks render as plain text with no links — this is what makes those
// mentions actually clickable.
export interface RelatedArticleSummary {
  slug: string;
  locale: string;
  headline: string;
}

export interface ArticleDetail {
  id: string;
  locale: string;
  slug: string;
  type: "BREAKING_NEWS" | "NEWS" | "ANALYSIS" | "EXPLAINER" | "COMPARISON" | "REVIEW" | "GUIDE" | "MARKET";
  headline: string;
  subtitle: string | null;
  keyTakeaway: string | null;
  authorType: string;
  publishedAt: string | null;
  blocks: ArticleBlock[];
  story: { id: string; title: string } | null;
  images: ArticleHeroImage[];
  citations: ArticleCitation[];
  carModels: ArticleRelatedCarModel[];
  relatedArticles: RelatedArticleSummary[];
  qualityVerdict: "publish" | "review" | "reject" | null;
}

// apps/worker/src/write-article.ts's real AI Writer stage output — the
// first real caller of packages/ai's AnthropicProvider.
export async function getArticle(locale: string, slug: string): Promise<ArticleDetail | null> {
  const res = await fetch(`${API_INTERNAL_URL}/v1/articles/${locale}/${slug}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API /v1/articles/${locale}/${slug} returned ${res.status}`);
  const { article, relatedArticles } = (await res.json()) as { article: ArticleDetail; relatedArticles: RelatedArticleSummary[] };
  return { ...article, relatedArticles };
}
