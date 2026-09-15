import type { MetadataRoute } from "next";
import { getCarModelSlugs, getTopicSlugs, getArticleSlugs, getBrands } from "@/lib/api";

// spec §29-31: a real sitemap enumerating actual indexable pages, not a
// static stub. Topic pages were a real gap fixed 2026-09-07: they
// existed and were linked from the homepage but were never added here.
//
// Real gap found and fixed 2026-09-09: this file's own comment used to
// say "Article URLs join this once apps/web has article pages" — that
// was accurate when written, but the Writer stage
// (apps/worker/src/write-article.ts) and the real article page both
// landed later without this ever being revisited: 0 of 105 real
// published articles were in the sitemap when this was found (by the
// user directly asking "will Google rank this?" and checking live).
//
// Real gap found and fixed 2026-09-07 (same day, later pass): the 6
// /about/* pages are real, indexable pages — each emits a real
// canonical/hreflang (fixed earlier the same day) and none carries
// noindex — but weren't reachable from the homepage's own markup (no
// site-wide nav/footer exists yet) and were entirely missing here too,
// this file's own comment above notwithstanding ("actual indexable
// pages"). /search is correctly still excluded: it sets
// `robots: { index: false }` on purpose (see apps/web/src/app/search/
// page.tsx), so it isn't an indexable page for this file to list.
const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

const ABOUT_PATHS = [
  "/about",
  "/about/editorial-policy",
  "/about/how-we-use-ai",
  "/about/corrections",
  "/about/contact",
];

// Real gap found and fixed 2026-09-08: no entry here ever set
// `lastModified`, even though real timestamp data exists for the car/
// topic pages — search engines use it to prioritize re-crawling pages
// that actually changed. `GET /v1/cars`/`GET /v1/topics` were widened to
// carry a real `lastModified` (the most recent `Fact.createdAt` for a
// car, the most recent `Story.lastUpdatedAt` for a topic) — `null` for a
// car/topic with no Fact/Story yet, a real, valid state, so `undefined`
// (Next's own MetadataRoute type omits the field entirely rather than
// emitting an empty `<lastmod>`) is substituted for `null` below rather
// than passing it through directly.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ topics }, { articles }, { brands }, { carModels }] = await Promise.all([
    getTopicSlugs(),
    getArticleSlugs(),
    getBrands(),
    getCarModelSlugs(),
  ]);

  return [
    { url: SITE_URL, changeFrequency: "hourly", priority: 1 },
    // /news index page (2026-09-11) — a real, paginated archive of every
    // published news Story; each individual article is already listed
    // via `articles` below, this only adds the index page's first page
    // (page 2+ isn't itself worth a separate sitemap entry — it's a
    // navigation aid over content already indexed elsewhere, same
    // reasoning as omitting /search below).
    { url: `${SITE_URL}/news`, changeFrequency: "hourly", priority: 0.6 },
    // /comparisons index page (2026-09-12) — each individual comparison/
    // analysis piece is still a published Article, already listed via
    // `articles` below; this only adds the index page itself.
    { url: `${SITE_URL}/comparisons`, changeFrequency: "weekly", priority: 0.6 },
    // /guides index page (2026-09-11) — each individual guide is still a
    // published Article, already listed via `articles` below; this only
    // adds the index page itself.
    { url: `${SITE_URL}/guides`, changeFrequency: "weekly", priority: 0.6 },
    // /brands index page (2026-09-11) — each brand's own /brands/[slug]
    // page is already listed via `brands` below; this only adds the
    // index page itself.
    { url: `${SITE_URL}/brands`, changeFrequency: "weekly", priority: 0.6 },
    // /compare (2026-09-16) — the picker page itself, same "index page
    // only" reasoning as the others above: a specific `?a=...&b=...`
    // comparison is one of 222×221 possible pairs, not something worth
    // (or feasible) enumerating here.
    { url: `${SITE_URL}/compare`, changeFrequency: "monthly", priority: 0.5 },
    // Real articles — the site's actual news content, and the highest
    // real priority of anything here besides the homepage itself.
    ...articles.map((article) => ({
      url: `${SITE_URL}/articles/${article.locale}/${article.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.9,
      lastModified: article.updatedAt,
    })),
    // Brand hub pages (vertical-slice plan, 2026-09-11) — no per-brand
    // "last changed" signal exists yet (unlike cars/topics above, which
    // have a real Fact/Story timestamp to point at), so `lastModified` is
    // simply omitted rather than guessed. Filtered to brands with real
    // content 2026-09-15, same rule as /brands's own index page and the
    // homepage's footer brand list — no point indexing a page with only
    // a name and a country on it.
    ...brands
      .filter((b) => b.contentCount > 0 || b.reviewedModelCount > 0)
      .map((b) => ({
      url: `${SITE_URL}/brands/${b.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    // Car catalog pages excluded 2026-09-14, restored 2026-09-15 — GET
    // /v1/cars now only returns models with >=2 real generations (see
    // that endpoint's own comment), the same bar the car model page's
    // `generateMetadata` uses for its noindex/index switch — so every
    // URL this lists is already meant to be indexed.
    ...carModels.map((car) => ({
      url: `${SITE_URL}/cars/${car.brandSlug}/${car.modelSlug}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
      lastModified: car.lastModified ?? undefined,
    })),
    ...topics.map((topic) => ({
      url: `${SITE_URL}/topics/${topic.slug}`,
      changeFrequency: "hourly" as const,
      priority: 0.6,
      lastModified: topic.lastModified ?? undefined,
    })),
    ...ABOUT_PATHS.map((path) => ({
      url: `${SITE_URL}${path}`,
      changeFrequency: "monthly" as const,
      priority: 0.4,
    })),
  ];
}
