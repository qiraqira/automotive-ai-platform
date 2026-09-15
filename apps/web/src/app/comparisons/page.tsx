import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getFeaturedArticles } from "@/lib/api";
import { isLogoImage, ListRowMedia } from "@/components/ArticleMedia";

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
export default async function ComparisonsIndexPage() {
  const { articles } = await getFeaturedArticles();

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
      <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)" }}>
        Comparisons &amp; Analysis
      </h2>
      <h1 style={{ fontSize: 28, margin: "4px 0 8px" }}>Real verdicts, not spec dumps</h1>
      <p style={{ color: "var(--ink-dim)", margin: "0 0 24px", maxWidth: "65ch" }}>
        Head-to-head comparisons and deeper analysis of the industry's own real moves — every spec sourced, every
        reviewer quote attributed, and a real conclusion at the end, not just numbers side by side.
      </p>
      <ul className="story-list">
        {articles.map((article) => {
          const isLogo = isLogoImage(article.images);
          return (
            <li key={article.slug} className="story-item" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {/* ListRowMedia — real "who vs whom" fix, 2026-09-16: a
                  COMPARISON article's second real hero photo (one per
                  car) used to be discarded here (GET /v1/featured-
                  articles capped `images` at 1, since bumped to 2) —
                  see that component's own comment. */}
              <ListRowMedia images={article.images} isLogo={isLogo} fallbackAlt={article.headline} />
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
        {articles.length === 0 && <p>No comparisons published yet.</p>}
      </ul>
    </section>
  );
}
