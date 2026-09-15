import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getBrands } from "@/lib/api";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

export async function generateMetadata(): Promise<Metadata> {
  const path = "/brands";
  const alternates = buildHreflangAlternates(SITE_URL, path);
  return {
    title: "Brands",
    description: "Every manufacturer covered on this site, with real specs, generations, crash tests and videos for each model.",
    alternates: {
      canonical: buildLocaleUrl(SITE_URL, "en", path),
      languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
    },
  };
}

// Real gap found and fixed 2026-09-11: GET /v1/brands (and its own
// /brands/[slug] detail page) has existed since the vertical-slice plan
// started, but nothing anywhere in the site's navigation — not the
// homepage, not the footer — ever linked to a brand or car model page.
// The only ways in were an article's own "Related cars" section or a
// topic feed's EntityRelation match; four fully-built model pages
// (specs, generations, crash tests, real videos) were otherwise
// unreachable from normal browsing. Same index-page pattern as /guides.
// Popular-first + alphabetical split (2026-09-14), user's own explicit
// ask: as more brands eventually get real coverage, a single flat list
// (alphabetical or not) either buries the brands with the most actual
// content or has no ordering logic at all. Split into a "Popular" list
// (ranked by real published-article count, ties broken alphabetically)
// and a plain "All brands" A-Z list for everything else — no client-side
// toggle, consistent with this site's plain, JS-optional pages.
const POPULAR_BRAND_LIMIT = 4;

export default async function BrandsIndexPage() {
  const { brands: allBrands } = await getBrands();
  // Real gap found live 2026-09-15: this page used to list every brand
  // regardless of whether its own page had anything on it — a brand
  // with zero published articles AND zero reviewed catalog models (29
  // of 36, right after this session's own broad brand-list expansion)
  // led to a real dead end: a name, a country, nothing else. Only a
  // brand with real content of either kind is listed here at all now.
  const brands = allBrands.filter((b) => b.contentCount > 0 || b.reviewedModelCount > 0);
  const ranked = [...brands].sort((a, b) => b.contentCount - a.contentCount || a.name.localeCompare(b.name));
  const popular = ranked.filter((b) => b.contentCount > 0).slice(0, POPULAR_BRAND_LIMIT);
  const popularSlugs = new Set(popular.map((b) => b.slug));
  const rest = brands.filter((b) => !popularSlugs.has(b.slug)).sort((a, b) => a.name.localeCompare(b.name));

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: "Brands", url: `${SITE_URL}/brands` },
  ]);

  return (
    <section>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      {/* SEO pass (2026-09-11): same H1/H2 swap as topics/guides pages —
          one real H1, the specific descriptive heading, not the generic
          eyebrow label. Same styles, same visual result. */}
      <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)" }}>
        Brands
      </h2>
      <h1 style={{ fontSize: 28, margin: "4px 0 20px" }}>Every manufacturer on this site</h1>

      {popular.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Popular brands</h2>
          <ul className="story-list">
            {popular.map((brand) => (
              <li key={brand.slug} className="story-item">
                <h3 style={{ fontSize: 18, margin: 0 }}>
                  <Link href={`/brands/${brand.slug}`}>{brand.name}</Link>
                </h3>
                {brand.country && <p className="story-meta" style={{ marginTop: 4 }}>{brand.country}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>All brands</h2>
        <ul className="story-list">
          {rest.map((brand) => (
            <li key={brand.slug} className="story-item">
              <h3 style={{ fontSize: 18, margin: 0 }}>
                <Link href={`/brands/${brand.slug}`}>{brand.name}</Link>
              </h3>
              {brand.country && <p className="story-meta" style={{ marginTop: 4 }}>{brand.country}</p>}
            </li>
          ))}
          {brands.length === 0 && <p>No brands added yet.</p>}
        </ul>
      </div>
    </section>
  );
}
