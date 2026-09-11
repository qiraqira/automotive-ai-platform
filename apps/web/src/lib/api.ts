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
  articles: { slug: string; locale: string; images: { image: { originalUrl: string } }[] }[];
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

export interface CarModelDetail {
  id: string;
  slug: string;
  name: string;
  brand: { id: string; slug: string; name: string; country: string | null };
  generations: CarGeneration[];
  facts: CarFact[];
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
}

// Real gap found and fixed 2026-09-07: every real Brand/CarModel in this
// DB exists only because seed.ts wrote it — nothing ever let an editor
// add a new one. This reads the real brand list back so /admin/cars's
// new "Add car model" form can offer a brand picker.
export function getBrands(): Promise<{ brands: Brand[] }> {
  return apiGet("/v1/brands");
}

export interface CarModelWithRelated {
  carModel: CarModelDetail;
  relatedStories: { id: string; title: string }[];
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

export interface TopicWithStories {
  topic: { id: string; slug: string; name: string };
  stories: StorySummary[];
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

export interface ArticleBlock {
  id: string;
  type: string;
  position: number;
  data: { text?: string };
}

export interface ArticleHeroImage {
  altText: string | null;
  image: { originalUrl: string; attribution: string | null; width: number | null; height: number | null };
}

export interface ArticleCitation {
  id: string;
  label: string;
  url: string;
}

export interface ArticleDetail {
  id: string;
  locale: string;
  slug: string;
  headline: string;
  subtitle: string | null;
  keyTakeaway: string | null;
  authorType: string;
  publishedAt: string | null;
  blocks: ArticleBlock[];
  story: { id: string; title: string } | null;
  images: ArticleHeroImage[];
  citations: ArticleCitation[];
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
  const { article } = (await res.json()) as { article: ArticleDetail };
  return article;
}
