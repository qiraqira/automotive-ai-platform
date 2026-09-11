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
export default async function BrandsIndexPage() {
  const { brands } = await getBrands();

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
      <ul className="story-list">
        {brands.map((brand) => (
          <li key={brand.slug} className="story-item">
            <h3 style={{ fontSize: 18, margin: 0 }}>
              <Link href={`/brands/${brand.slug}`}>{brand.name}</Link>
            </h3>
            {brand.country && <p className="story-meta" style={{ marginTop: 4 }}>{brand.country}</p>}
          </li>
        ))}
        {brands.length === 0 && <p>No brands added yet.</p>}
      </ul>
    </section>
  );
}
