import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getFeaturedArticles } from "@/lib/api";
import { isLogoImage, LeadMedia } from "@/components/ArticleMedia";
import { ContentCard } from "@/components/ContentCard";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

export async function generateMetadata(): Promise<Metadata> {
  const path = "/comparisons";
  const alternates = buildHreflangAlternates(SITE_URL, path);
  return {
    title: "Comparisons & Analysis",
    description: "Side-by-side car comparisons and deeper analysis pieces — real specs, real reviewer verdicts, and a real answer, not a spec sheet with no conclusion.",
    alternates: {
      canonical: buildLocaleUrl(SITE_URL, "en", path),
      languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
    },
  };
}

// Real gap found and fixed 2026-09-12, user's own explicit request: the
// homepage's "Comparisons & analysis" section already listed every real
// COMPARISON/ANALYSIS article (GET /v1/featured-articles), but there was
// no dedicated page to link a "See all" to and no real place for this
// content to grow into — same real gap /guides closed for GUIDE-type
// content, just never extended to this type.
//
// Premium redesign, 2026-09-17 — user's own direct ask ("весь раздел
// надо переработать в новом стиле как главная") to bring this page in
// line with the 2026-09-16 homepage redesign rather than leaving it as
// the old plain `<ul className="story-list">` text layout. Leads with
// the newest article (GET /v1/featured-articles already orders by
// publishedAt desc) as a large featured card — same real photos, same
// LeadMedia paired-image handling as every other article list on the
// site — then the rest in the same ContentCard grid the homepage's own
// "Comparisons & Analysis" section uses.
export default async function ComparisonsIndexPage() {
  const { articles } = await getFeaturedArticles();
  const [featured, ...rest] = articles;

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: "Comparisons & Analysis", url: `${SITE_URL}/comparisons` },
  ]);

  return (
    <section>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 6 }}>
        Comparisons &amp; Analysis
      </div>
      <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(26px, 3.5vw, 36px)", fontWeight: 800, margin: "0 0 10px", lineHeight: 1.15 }}>
        Real verdicts, not spec dumps
      </h1>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: 15.5, color: "var(--ink-dim)", margin: "0 0 32px", maxWidth: "65ch", lineHeight: 1.6 }}>
        Head-to-head comparisons and deeper analysis of the industry&apos;s own real moves — every spec sourced, every
        reviewer quote attributed, and a real conclusion at the end, not just numbers side by side.
      </p>

      {featured && (
        <Link
          href={`/articles/${featured.locale}/${featured.slug}`}
          className="premium-card"
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", gap: 0, marginBottom: 40, alignItems: "stretch" }}
        >
          <div style={{ position: "relative", minHeight: 260 }}>
            <LeadMedia
              images={featured.images}
              isLogo={isLogoImage(featured.images)}
              fallbackAlt={featured.headline}
              width="100%"
              borderRadius={0}
              marginBottom={0}
            />
            {featured.images.length > 0 && !isLogoImage(featured.images) && (
              <span
                style={{
                  position: "absolute",
                  top: 16,
                  left: 16,
                  fontFamily: "var(--font-sans)",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "#fff",
                  background: "rgba(15,18,23,0.85)",
                  padding: "4px 10px",
                  borderRadius: 100,
                }}
              >
                {featured.type}
              </span>
            )}
          </div>
          <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 10 }}>
              Latest comparison
            </div>
            <h2 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(22px, 2.6vw, 30px)", fontWeight: 800, margin: "0 0 12px", lineHeight: 1.2 }}>
              {featured.headline}
            </h2>
            {featured.subtitle && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--ink-dim)", lineHeight: 1.6, margin: "0 0 18px" }}>{featured.subtitle}</p>
            )}
            <span style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>Read the full comparison →</span>
          </div>
        </Link>
      )}

      {rest.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
          {rest.map((article) => (
            <ContentCard
              key={article.slug}
              href={`/articles/${article.locale}/${article.slug}`}
              images={article.images}
              isLogo={isLogoImage(article.images)}
              fallbackAlt={article.headline}
              badge={article.type}
              title={article.headline}
              description={article.subtitle}
              linkText="View Comparison"
            />
          ))}
        </div>
      )}

      {articles.length === 0 && <p>No comparisons published yet.</p>}
    </section>
  );
}
