import type { Metadata } from "next";
import Link from "next/link";
import { computeRankingScore } from "@automotive/editorial";
import { buildHreflangAlternates, buildLocaleUrl } from "@automotive/seo";
import {
  getGuides,
  getBrands,
  getFeaturedArticles,
  getFeaturedCars,
  getStories,
  type FeaturedArticleSummary,
  type StorySummary,
} from "@/lib/api";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const SITE_NAME = process.env.PROJECT_NAME ?? "PROJECT_NAME";

// SEO pass (2026-09-11): the homepage never set its own title/
// description before, silently inheriting layout.tsx's generic
// site-wide default on every page that didn't override it — a real,
// meaningful gap once the homepage itself became a page with real,
// specific content (car specs, comparisons, guides) worth describing
// on its own rather than falling back to the site-wide tagline. The
// copy below accurately describes the sections actually rendered
// further down this file (Explore models -> real specs, Comparisons &
// analysis -> real comparisons) — see SEO.md's homepage rule.
const HOME_TITLE = "Car Specs, Models & Comparisons";
const HOME_DESCRIPTION =
  "Explore car specifications, generations, safety ratings and comparisons. Research models by brand, compare engines and powertrains, and follow the latest automotive news.";

export const metadata: Metadata = {
  // Verified live: unlike every nested route (car/brand/guides/topics
  // pages), the root "/" page does not inherit layout.tsx's title
  // template — Next.js resolves the root layout+page pair as a single
  // segment rather than templating across it. Suffixing manually here is
  // the one deliberate exception to SEO.md's "bare string, no suffix"
  // rule, and only because the template genuinely doesn't reach this
  // route.
  title: `${HOME_TITLE} | ${SITE_NAME}`,
  description: HOME_DESCRIPTION,
  alternates: {
    canonical: buildLocaleUrl(SITE_URL, "en", ""),
    languages: Object.fromEntries(buildHreflangAlternates(SITE_URL, "").map((a) => [a.hreflang, a.href])),
  },
  openGraph: {
    type: "website",
    title: `${HOME_TITLE} | ${SITE_NAME}`,
    description: HOME_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
  },
  twitter: {
    card: "summary",
    title: `${HOME_TITLE} | ${SITE_NAME}`,
    description: HOME_DESCRIPTION,
  },
};

// Portal homepage (2026-09-11), replacing the old news-FEED layout, per
// the user's own explicit instruction: "не как новостная лента была, а
// ... портал" — the fix was to stop leading with a chronological feed,
// not to remove news from the site. User's own correction the same day,
// after seeing the result live: the real articles this pipeline writes
// still belong on the homepage, just as one section among the portal's
// others rather than the dominant, page-topping list it used to be.
// "Light" design: plain type, generous whitespace, no cards/shadows/
// gradients — the same undecorated visual language as the rest of the
// site, just reordered as a portal's front page.
function isLogoImage(images: FeaturedArticleSummary["images"]): boolean {
  const img = images[0]?.image;
  if (!img) return false;
  return img.rightsStatus === "EDITORIAL_ONLY" || img.originalUrl.toLowerCase().includes("logo");
}

function averageSourceTrust(story: StorySummary): number {
  if (story.sources.length === 0) return 50;
  const total = story.sources.reduce((sum, s) => sum + s.source.trustScore, 0);
  return total / story.sources.length;
}

function rankStories(stories: StorySummary[]): StorySummary[] {
  const now = new Date();
  return [...stories].sort((a, b) => {
    const scoreA = computeRankingScore({
      importanceScore: a.importanceScore,
      sourceQualityScore: averageSourceTrust(a),
      publishedAt: new Date(a.lastUpdatedAt),
      now,
    });
    const scoreB = computeRankingScore({
      importanceScore: b.importanceScore,
      sourceQualityScore: averageSourceTrust(b),
      publishedAt: new Date(b.lastUpdatedAt),
      now,
    });
    return scoreB - scoreA;
  });
}

export default async function HomePage() {
  const [{ carModels: featuredCars }, { articles: featuredArticles }, { guides }, { brands }, { stories: unrankedStories }] =
    await Promise.all([
      getFeaturedCars(),
      getFeaturedArticles(),
      getGuides(),
      getBrands(),
      getStories({ limit: 20, hasArticle: true }),
    ]);
  const news = rankStories(unrankedStories).slice(0, 8);

  return (
    <>
      <section style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 32, margin: "0 0 12px" }}>Real cars, real numbers, no filler</h1>
        <p style={{ fontSize: 17, color: "var(--ink-dim)", maxWidth: 640, lineHeight: 1.5 }}>
          Specs, generations, crash-test ratings and side-by-side comparisons — every figure sourced and checked, every
          photo the real car.
        </p>
      </section>

      {featuredCars.length > 0 && (
        // Real gap found and fixed 2026-09-11: four (now five) fully-built
        // model pages existed with zero visual entry point anywhere on the
        // site — only reachable via an article's own cross-link or a
        // brand page. Only models with a real HERO CarModelImage are ever
        // returned by GET /v1/featured-cars, so this grid never shows an
        // empty/placeholder tile.
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)", marginBottom: 12 }}>
            Explore models
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
            {featuredCars.map((car) => (
              <Link key={`${car.brandSlug}-${car.modelSlug}`} href={`/cars/${car.brandSlug}/${car.modelSlug}`} style={{ display: "block" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment */}
                {/* Real gap found and fixed 2026-09-11 (user's own mobile
                    screenshot): a fixed 120px height cropped fine at
                    desktop's ~180-220px tile width, but the same grid
                    collapses to ONE full-width column on a narrow phone
                    screen (minmax(180px, 1fr)'s own responsive behavior)
                    — a car photo stretched to 350-400px wide with a
                    still-120px-tall crop cut off far more of the car
                    than intended. `aspectRatio` scales the crop
                    proportionally with the tile's actual width at any
                    screen size instead of a screen-size-blind pixel
                    height. */}
                <img
                  src={car.imageUrl}
                  alt={`${car.brandName} ${car.modelName}`}
                  style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 6, marginBottom: 8 }}
                />
                <div style={{ fontWeight: 600 }}>
                  {car.brandName} {car.modelName}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {news.length > 0 && (
        // Restored 2026-09-11 (same day as the portal rewrite, per the
        // user's own follow-up): real news the pipeline actually wrote
        // still needs a home on the homepage — just as one section here,
        // not the page-topping feed it used to be. Same heroUrl/isLogo
        // rendering as the old "Latest" section and the per-Topic pages.
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)", marginBottom: 12 }}>
            Latest news
          </h2>
          <ul className="story-list">
            {news.map((story) => {
              const heroUrl = story.articles[0]?.images[0]?.image.originalUrl;
              const isLogo =
                story.articles[0]?.images[0]?.image.rightsStatus === "EDITORIAL_ONLY" ||
                (heroUrl?.toLowerCase().includes("logo") ?? false);
              return (
                <li key={story.id} className="story-item" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {heroUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
                    <img
                      src={heroUrl}
                      alt=""
                      style={{
                        width: 96,
                        height: 64,
                        objectFit: isLogo ? "contain" : "cover",
                        background: isLogo ? "#fff" : undefined,
                        padding: isLogo ? 8 : undefined,
                        flexShrink: 0,
                        borderRadius: 4,
                      }}
                    />
                  )}
                  <div>
                    <div className="story-meta">
                      {story._count.sourceArticles} source{story._count.sourceArticles === 1 ? "" : "s"}
                      {story.sources[0] ? ` · via ${story.sources[0].source.name}` : ""}
                      {story.primaryTopic ? (
                        <>
                          {" · "}
                          <Link href={`/topics/${story.primaryTopic.slug}`}>{story.primaryTopic.name}</Link>
                        </>
                      ) : null}
                    </div>
                    <h3 style={{ fontSize: 18, margin: 0 }}>
                      {story.articles[0] ? <Link href={`/articles/en/${story.articles[0].slug}`}>{story.title}</Link> : story.title}
                    </h3>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {featuredArticles.length > 0 && (
        // Real gap found and fixed 2026-09-11: the site's 5 hand-authored
        // COMPARISON/ANALYSIS pieces had no listing endpoint or homepage
        // section at all (see GET /v1/featured-articles's own comment) —
        // exactly the kind of evergreen content a portal's front page
        // should lead with, unlike the news feed this replaces.
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)", marginBottom: 12 }}>
            Comparisons &amp; analysis
          </h2>
          <ul className="story-list">
            {featuredArticles.map((article) => {
              const heroUrl = article.images[0]?.image.originalUrl;
              const isLogo = isLogoImage(article.images);
              return (
                <li key={article.slug} className="story-item" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {heroUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
                    <img
                      src={heroUrl}
                      alt=""
                      style={{
                        width: 96,
                        height: 64,
                        objectFit: isLogo ? "contain" : "cover",
                        background: isLogo ? "#fff" : undefined,
                        padding: isLogo ? 8 : undefined,
                        flexShrink: 0,
                        borderRadius: 4,
                      }}
                    />
                  )}
                  <div>
                    <div className="story-meta">{article.type}</div>
                    <h3 style={{ fontSize: 18, margin: 0 }}>
                      <Link href={`/articles/${article.locale}/${article.slug}`}>{article.headline}</Link>
                    </h3>
                    {article.subtitle && <p className="story-meta" style={{ marginTop: 4 }}>{article.subtitle}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {guides.length > 0 && (
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)", marginBottom: 12 }}>
            <Link href="/guides">Guides</Link>
          </h2>
          <ul className="story-list">
            {guides.slice(0, 6).map((guide) => (
              <li key={guide.slug} className="story-item">
                <h3 style={{ fontSize: 18, margin: 0 }}>
                  <Link href={`/articles/${guide.locale}/${guide.slug}`}>{guide.headline}</Link>
                </h3>
                {guide.subtitle && <p className="story-meta" style={{ marginTop: 4 }}>{guide.subtitle}</p>}
              </li>
            ))}
          </ul>
          {guides.length > 6 && (
            <p className="story-meta">
              <Link href="/guides">See all {guides.length} →</Link>
            </p>
          )}
        </section>
      )}

      {brands.length > 0 && (
        <section>
          <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)", marginBottom: 12 }}>
            <Link href="/brands">Brands</Link>
          </h2>
          <ul style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", listStyle: "none", padding: 0, margin: 0 }}>
            {brands.map((brand) => (
              <li key={brand.slug} style={{ fontSize: 16 }}>
                <Link href={`/brands/${brand.slug}`}>{brand.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
