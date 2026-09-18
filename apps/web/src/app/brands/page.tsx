import type { Metadata } from "next";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getBrands, type Brand } from "@/lib/api";
import { ContentCard } from "@/components/ContentCard";

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

// Premium redesign, 2026-09-18 — user's own direct ask to bring /brands
// in line with the same ContentCard-grid style already applied to
// /news, /guides, /comparisons and /topics/[slug]. A Brand carries no
// photo of its own (see the `Brand` interface — no `images` field), so
// ContentCard's LeadMedia renders nothing for these cards and they fall
// back to a plain text card — an intentional, already-supported
// degradation, not a special case. ContentCard's own badge chip is
// absolutely-positioned over the photo and never renders without one
// (see ContentCard.tsx's `images.length > 0 && !isLogo` guard), so
// `country` is folded into the description line here instead of passed
// as `badge`, or it would silently disappear for every brand.
function brandDescription(brand: Brand): string {
  const parts: string[] = [];
  if (brand.country) parts.push(brand.country);
  if (brand.contentCount > 0) parts.push(`${brand.contentCount} stor${brand.contentCount === 1 ? "y" : "ies"}`);
  if (brand.reviewedModelCount > 0) parts.push(`${brand.reviewedModelCount} model${brand.reviewedModelCount === 1 ? "" : "s"} reviewed`);
  return parts.join(" · ");
}

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
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 6 }}>
        Brands
      </div>
      <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(26px, 3.5vw, 36px)", fontWeight: 800, margin: "0 0 32px", lineHeight: 1.15 }}>
        Every manufacturer on this site
      </h1>

      {popular.length > 0 && (
        <div style={{ marginBottom: 48 }}>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 20 }}>
            Popular brands
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 24 }}>
            {popular.map((brand) => (
              <ContentCard
                key={brand.slug}
                href={`/brands/${brand.slug}`}
                images={[]}
                isLogo={false}
                fallbackAlt={brand.name}
                badge={brand.country ?? "Brand"}
                title={brand.name}
                description={brandDescription(brand)}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 20 }}>
          All brands
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 24 }}>
          {rest.map((brand) => (
            <ContentCard
              key={brand.slug}
              href={`/brands/${brand.slug}`}
              images={[]}
              isLogo={false}
              fallbackAlt={brand.name}
              badge={brand.country ?? "Brand"}
              title={brand.name}
              description={brandDescription(brand)}
            />
          ))}
        </div>
        {brands.length === 0 && <p>No brands added yet.</p>}
      </div>
    </section>
  );
}
