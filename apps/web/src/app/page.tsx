import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl } from "@automotive/seo";
import { getGuides, getBrands, getFeaturedArticles, getFeaturedCars, getStories, type FeaturedArticleSummary } from "@/lib/api";
import { rankStories } from "@/lib/ranking";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const SITE_NAME = process.env.PROJECT_NAME ?? "PROJECT_NAME";

// Cap added 2026-09-14 — see the section below's own longer comment.
const HOMEPAGE_ARTICLE_LIMIT = 7;

// SEO pass (2026-09-11): the homepage never set its own title/
// description before, silently inheriting layout.tsx's generic
// site-wide default on every page that didn't override it — a real,
// meaningful gap once the homepage itself became a page with real,
// specific content worth describing on its own rather than falling back
// to the site-wide tagline. See SEO.md's homepage rule.
//
// Rewritten 2026-09-14, user's own explicit ask to build a real keyword
// core and check it against what the homepage actually leads with now.
// The old title ("Car Specs, Models, Comparisons & Auto News") was
// written when the catalog ("Explore models" -> specs/generations) was
// still the homepage's second section — it's since been paused and
// hidden (see this same date's "Explore models" gate below), so leading
// the title with "Specs, Models" no longer matches what a visitor
// actually lands on. What the site's real published content overwhelm-
// ingly is now: COMPARISON/ANALYSIS pieces (a "Tesla Model 3 vs Toyota
// Corolla" piece is, in substance, a car review — the word "review"
// itself never appeared anywhere in the old title/description despite
// that being real, high-intent search volume in this vertical) and real
// NEWS. "Auto news" (not just "automotive news") kept from the
// 2026-09-12 fix for the same reason as before: it's how people actually
// phrase the search.
const HOME_TITLE = "Car Comparisons, Reviews & Auto News";
const HOME_DESCRIPTION =
  "In-depth car comparisons and reviews with real specs and safety ratings, plus the latest auto news — every figure sourced and checked.";

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
        {/* H1 rewritten 2026-09-14 alongside HOME_TITLE/HOME_DESCRIPTION
            above — same reasoning: carries the real target keywords
            ("car comparisons", "auto news") instead of a pure tagline,
            while the subtitle below is the one line that actually says
            "reviews" out loud. */}
        <h1 style={{ fontSize: 32, margin: "0 0 12px" }}>Car comparisons and auto news, backed by real numbers</h1>
        <p style={{ fontSize: 17, color: "var(--ink-dim)", maxWidth: 640, lineHeight: 1.5 }}>
          In-depth comparisons and reviews — every spec, safety rating and price checked, every photo the real car —
          plus real auto news, covered the same way, as it happens.
        </p>
      </section>

      {featuredArticles.length > 0 && (
        // Real gap found and fixed 2026-09-11: the site's hand-authored
        // COMPARISON/ANALYSIS pieces had no listing endpoint or homepage
        // section at all (see GET /v1/featured-articles's own comment) —
        // exactly the kind of evergreen content a portal's front page
        // should lead with, unlike the news feed this replaces.
        //
        // Moved to the very top 2026-09-12, user's own explicit request:
        // the portal's own evergreen flagship content (comparisons/
        // analysis) belongs before even the model grid on a page whose
        // whole point is not being a news feed. "See all" links to the
        // new /comparisons index page (apps/web/src/app/comparisons/page.tsx).
        //
        // Lead-story layout + hard cap (2026-09-14), user's own explicit
        // ask: this list had no cap at all (the API's own `take: 200` is
        // for /comparisons' real "see everything" page, not this one) —
        // it would have grown unbounded as more pieces get published.
        // Capped to HOMEPAGE_ARTICLE_LIMIT here, client-side only (same
        // pattern the Guides section below already uses), so /comparisons
        // stays the actual full list. The newest piece also now renders
        // as a real "portal lead story" — big photo, headline, and the
        // article's own first paragraph — instead of the same small
        // thumbnail row as everything else, addressing the user's own
        // worry that pausing the catalog would leave the homepage looking
        // like a bare, uniform feed rather than a real portal front page.
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)", marginBottom: 12 }}>
            <Link href="/comparisons">Comparisons &amp; analysis</Link>
          </h2>
          {(() => {
            const shown = featuredArticles.slice(0, HOMEPAGE_ARTICLE_LIMIT);
            const [lead, ...rest] = shown;
            const leadHeroUrl = lead.images[0]?.image.originalUrl;
            const leadIsLogo = isLogoImage(lead.images);
            return (
              <>
                <div style={{ marginBottom: 24 }}>
                  {leadHeroUrl && !leadIsLogo && (
                    // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
                    <img
                      src={leadHeroUrl}
                      alt=""
                      style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 6, marginBottom: 12, display: "block" }}
                    />
                  )}
                  <div className="story-meta">{lead.type}</div>
                  <h3 style={{ fontSize: 26, margin: "4px 0 8px", lineHeight: 1.25 }}>
                    <Link href={`/articles/${lead.locale}/${lead.slug}`}>{lead.headline}</Link>
                  </h3>
                  {lead.subtitle && <p style={{ fontSize: 16, color: "var(--ink-dim)", maxWidth: "38em", margin: 0 }}>{lead.subtitle}</p>}
                </div>
                {rest.length > 0 && (
                  <ul className="story-list">
                    {rest.map((article) => {
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
                )}
              </>
            );
          })()}
          <p className="story-meta">
            <Link href="/comparisons">See all {featuredArticles.length} comparisons &amp; analysis →</Link>
          </p>
        </section>
      )}

      {
        // Paused 2026-09-14, briefly resumed 2026-09-15 (GET
        // /v1/featured-cars gated to >=2 real generations), re-paused
        // the same day — user's own direct verdict after the >=2-
        // generations gate went live: "каталоги просмотри. x5 сделан
        // супер, а остальное некачественно" (X5 — hand-built one model
        // at a time, real editorial review — is great; everything else,
        // from the unattended bulk auto-seed + generation-discovery
        // sweep, is not good enough). >=2 generations catches gross
        // placeholder stubs but not real quality problems (duplicate/
        // overlapping generations, unreviewed photos, raw EPA option
        // text as a trim name) — not something to feature prominently on
        // the homepage until each model gets the same hand review the
        // X5/GLE/F-150/Mustang/RAV4/Model Y did. Catalog links still
        // live in the footer nav either way.
        false &&
          featuredCars.length > 0 && (
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
        //
        // "See all" link added 2026-09-11, user's own explicit request:
        // this sliced to 8 with no way to reach the other 130+ real
        // published news articles — the exact same real gap /guides
        // already avoided (its own "See all N" pattern below). /news is
        // a new, real paginated archive (apps/web/src/app/news/page.tsx),
        // not a dead link.
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)", marginBottom: 12 }}>
            Latest news
          </h2>
          {(() => {
            // Same portal-lead treatment as Comparisons & analysis above
            // (2026-09-14, user's own explicit ask): the newest news item
            // gets a big photo + headline instead of the same 96x64
            // thumbnail row as everything else.
            const [lead, ...rest] = news;
            const leadHeroUrl = lead.articles[0]?.images[0]?.image.originalUrl;
            const leadIsLogo =
              lead.articles[0]?.images[0]?.image.rightsStatus === "EDITORIAL_ONLY" ||
              (leadHeroUrl?.toLowerCase().includes("logo") ?? false);
            const renderMeta = (story: (typeof news)[number]) => (
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
            );
            return (
              <>
                <div style={{ marginBottom: 24 }}>
                  {leadHeroUrl && !leadIsLogo && (
                    // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
                    <img
                      src={leadHeroUrl}
                      alt=""
                      style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 6, marginBottom: 12, display: "block" }}
                    />
                  )}
                  {renderMeta(lead)}
                  <h3 style={{ fontSize: 26, margin: "4px 0 0", lineHeight: 1.25 }}>
                    {lead.articles[0] ? <Link href={`/articles/en/${lead.articles[0].slug}`}>{lead.title}</Link> : lead.title}
                  </h3>
                </div>
                {rest.length > 0 && (
                  <ul className="story-list">
                    {rest.map((story) => {
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
                            {renderMeta(story)}
                            <h3 style={{ fontSize: 18, margin: 0 }}>
                              {story.articles[0] ? <Link href={`/articles/en/${story.articles[0].slug}`}>{story.title}</Link> : story.title}
                            </h3>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            );
          })()}
          <p className="story-meta">
            <Link href="/news">See all news →</Link>
          </p>
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
