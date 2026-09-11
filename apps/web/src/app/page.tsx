import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl } from "@automotive/seo";
import { getGuides, getBrands, getFeaturedArticles, getFeaturedCars, type FeaturedArticleSummary } from "@/lib/api";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// spec §22/§30: the homepage needs the same real hreflang/canonical as
// the car page (packages/seo) — previously only the car page had it,
// which was an inconsistency, not a deliberate scope cut.
export const metadata: Metadata = {
  alternates: {
    canonical: buildLocaleUrl(SITE_URL, "en", ""),
    languages: Object.fromEntries(buildHreflangAlternates(SITE_URL, "").map((a) => [a.hreflang, a.href])),
  },
};

// Portal homepage (2026-09-11), replacing the old news-feed layout, per
// the user's own explicit, repeated instruction: "не как новостная
// лента была, а ... портал" / "Статьи на главной месте, новости нет. Но
// дизайн легкий?" The old "Latest" Story feed and per-Topic news
// sections are gone entirely — a news feed is exactly what this is no
// longer meant to be. What's left is everything on the site that's
// real, evergreen, and worth a reader's first look: real car models
// with real photos, real comparisons/analysis, real guides, real
// brands. "Light" design: plain type, generous whitespace, no cards/
// shadows/gradients — this is still the same undecorated visual
// language the rest of the site uses, just organized as a portal's
// front page instead of a chronological feed.
function isLogoImage(images: FeaturedArticleSummary["images"]): boolean {
  const img = images[0]?.image;
  if (!img) return false;
  return img.rightsStatus === "EDITORIAL_ONLY" || img.originalUrl.toLowerCase().includes("logo");
}

export default async function HomePage() {
  const [{ carModels: featuredCars }, { articles: featuredArticles }, { guides }, { brands }] = await Promise.all([
    getFeaturedCars(),
    getFeaturedArticles(),
    getGuides(),
    getBrands(),
  ]);

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
                <img
                  src={car.imageUrl}
                  alt={`${car.brandName} ${car.modelName}`}
                  style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 6, marginBottom: 8 }}
                />
                <div style={{ fontWeight: 600 }}>
                  {car.brandName} {car.modelName}
                </div>
              </Link>
            ))}
          </div>
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
