import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { formatCountryName } from "@automotive/utils";
import { getBrand } from "@/lib/api";
import { ContentCard } from "@/components/ContentCard";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const SITE_NAME = process.env.PROJECT_NAME ?? "PROJECT_NAME";

// Real brand hub page (vertical-slice plan, 2026-09-11, spec's "Brand
// Pages" section): a person searching "BMW" should land somewhere that
// lists every real BMW model this site covers plus its real news, not
// just whichever single model page they happened to land on. Same
// hreflang/canonical shape as the car-model page's own generateMetadata —
// the /es/ edition doesn't exist yet, but declaring the alternate now
// costs nothing and documents the intended URL for when it does.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const path = `/brands/${slug}`;
  const alternates = buildHreflangAlternates(SITE_URL, path);
  const canonicalUrl = buildLocaleUrl(SITE_URL, "en", path);
  const base: Metadata = {
    alternates: {
      canonical: canonicalUrl,
      languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
    },
  };

  // SEO pass (2026-09-11): real gap, same shape as the car page's own —
  // every brand page shared the site-wide default title with no way to
  // tell BMW's page from Toyota's in a search result. Built only from
  // sections this page actually renders (models / news), per the
  // brief's "only mention information that actually exists" rule.
  const result = await getBrand(slug);
  if (!result) return base;
  const { brand, relatedArticles, relatedStories } = result;

  // Added 2026-09-15, alongside filtering these dead-end brands out of
  // the sitemap/brands-index/homepage list: a brand this session hasn't
  // filtered from its OWN list can still be reached by a direct link
  // (an old bookmark, an external site) — a page with only a name and a
  // country on it shouldn't be indexed even then.
  if (relatedArticles.length === 0 && relatedStories.length === 0 && brand.models.length === 0) {
    return { ...base, robots: { index: false, follow: true } };
  }

  const parts: string[] = [];
  if (relatedArticles.length > 0) parts.push("Comparisons & Analysis");
  if (relatedStories.length > 0) parts.push("News");
  const title = parts.length > 0 ? `${brand.name}: ${parts.join(" & ")}` : `${brand.name} Cars`;
  const description = `Real ${brand.name} coverage on ${SITE_NAME}${
    relatedArticles.length > 0 ? " — comparisons and analysis" : ""
  }${relatedStories.length > 0 ? (relatedArticles.length > 0 ? " plus the latest news" : " — the latest news") : ""}, sourced and checked.`;

  return {
    ...base,
    title,
    description,
    openGraph: { type: "website", title: `${title} | ${SITE_NAME}`, description, url: canonicalUrl, siteName: SITE_NAME },
    twitter: { card: "summary", title: `${title} | ${SITE_NAME}`, description },
  };
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getBrand(slug);
  if (!result) notFound();
  const { brand, relatedArticles, relatedStories } = result;

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: brand.name, url: `${SITE_URL}/brands/${slug}` },
  ]);

  return (
    <article>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 6 }}>
        Brand
      </div>
      {/* Premium redesign, 2026-09-18 — same eyebrow+H1+ContentCard-grid
          pattern already applied to /topics/[slug], /guides, /brands.
          The brand's own logo (Brand.logoImageId, backfilled the same
          day) sits next to the H1 the same way ContentCard's own
          `logoUrl` badge sits next to a card title — one small,
          consistent "this is the brand" visual anchor across the site. */}
      <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(26px, 3.5vw, 36px)", fontWeight: 800, margin: "0 0 8px", lineHeight: 1.15, display: "flex", alignItems: "center", gap: 14 }}>
        {brand.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
          <img src={brand.logoUrl} alt="" style={{ width: 44, height: 44, objectFit: "contain", background: "#fff", borderRadius: 8, padding: 5, flexShrink: 0 }} />
        )}
        <span>{brand.name}</span>
      </h1>
      {brand.country && (
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, color: "var(--ink-dim)", marginBottom: 32 }}>{formatCountryName(brand.country)}</div>
      )}

      {/* "Models" section removed 2026-09-14 (catalog paused), restored
          2026-09-15 gated on generationCount>=2, narrowed the same day
          to GET /v1/brands/:slug's own `catalogReviewedAt` filter — a
          generation count alone let unreviewed, duplicate-riddled bulk-
          sweep output onto this page (user's verdict: "x5 сделан супер,
          а остальное некачественно"). `brand.models` here is already
          review-filtered server-side, so no client-side check is needed
          — a brand with zero reviewed models shows no section at all. */}
      {brand.models.length > 0 && (
        <section style={{ marginBottom: 48 }}>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 20 }}>
            {brand.name} models
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 24 }}>
            {brand.models.map((model) => (
              <ContentCard
                key={model.slug}
                href={`/cars/${slug}/${model.slug}`}
                images={model.imageUrl ? [{ altText: `${brand.name} ${model.name}`, image: { originalUrl: model.imageUrl, width: model.imageWidth, height: model.imageHeight } }] : []}
                isLogo={false}
                fallbackAlt={`${brand.name} ${model.name}`}
                badge="Model"
                title={model.name}
                linkText="View specs"
              />
            ))}
          </div>
        </section>
      )}

      {relatedArticles.length > 0 && (
        // Added 2026-09-14, user's own explicit ask: a brand hub should
        // surface the real comparisons/analysis pieces already written
        // about this brand's own models, not just its catalog page links
        // and raw news — see GET /v1/brands/:slug's own comment for how
        // this is found (ArticleCarModel, not a name match).
        <section style={{ marginBottom: 48 }}>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 20 }}>
            {brand.name} comparisons &amp; analysis
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 24 }}>
            {relatedArticles.map((article) => (
              <ContentCard
                key={article.slug}
                href={`/articles/en/${article.slug}`}
                images={[]}
                isLogo={false}
                fallbackAlt={article.headline}
                badge={article.type}
                title={article.headline}
                description={article.subtitle}
              />
            ))}
          </div>
        </section>
      )}

      {relatedStories.length > 0 && (
        <section>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 20 }}>
            Latest {brand.name} news
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 24 }}>
            {relatedStories.map((story) => (
              <ContentCard
                key={story.id}
                href={story.articleSlug ? `/articles/en/${story.articleSlug}` : `/brands/${slug}`}
                images={[]}
                isLogo={false}
                fallbackAlt={story.articleHeadline ?? story.title}
                badge="News"
                title={story.articleHeadline ?? story.title}
              />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
