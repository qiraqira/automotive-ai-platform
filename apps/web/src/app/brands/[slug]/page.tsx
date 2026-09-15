import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { formatCountryName } from "@automotive/utils";
import { getBrand } from "@/lib/api";

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
      {brand.country && <div className="story-meta">{formatCountryName(brand.country)}</div>}
      <h1 style={{ fontSize: 32, margin: "4px 0 20px" }}>{brand.name}</h1>
      {/* "Models" section removed 2026-09-14 (catalog paused, every page
          nowhere near ready), restored 2026-09-15 once the catalog work
          resumed — gated to only the models that have actually been
          taken to real completeness (>=2 real generations, not the
          single "Overview" placeholder auto-seed-catalog.ts leaves on
          everything it touches), same bar GET /v1/cars and GET
          /v1/featured-cars now both apply. A brand with zero qualifying
          models (most of them, still) shows no Models section at all
          rather than a section full of noindexed one-generation stubs. */}
      {(() => {
        const readyModels = brand.models.filter((m) => m.generationCount >= 2);
        if (readyModels.length === 0) return null;
        return (
          <section style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 16 }}>{brand.name} models</h2>
            <ul className="story-list">
              {readyModels.map((model) => (
                <li key={model.slug} className="story-item">
                  <Link href={`/cars/${slug}/${model.slug}`}>{model.name}</Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

      {relatedArticles.length > 0 && (
        // Added 2026-09-14, user's own explicit ask: a brand hub should
        // surface the real comparisons/analysis pieces already written
        // about this brand's own models, not just its catalog page links
        // and raw news — see GET /v1/brands/:slug's own comment for how
        // this is found (ArticleCarModel, not a name match).
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16 }}>{brand.name} comparisons &amp; analysis</h2>
          <ul className="story-list">
            {relatedArticles.map((article) => (
              <li key={article.slug} className="story-item">
                <div className="story-meta">{article.type}</div>
                <Link href={`/articles/en/${article.slug}`}>{article.headline}</Link>
                {article.subtitle && <p className="story-meta" style={{ marginTop: 4 }}>{article.subtitle}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {relatedStories.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16 }}>Latest {brand.name} news</h2>
          <ul className="story-list">
            {relatedStories.map((story) => (
              <li key={story.id} className="story-item">
                {story.articleSlug ? <Link href={`/articles/en/${story.articleSlug}`}>{story.title}</Link> : story.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
