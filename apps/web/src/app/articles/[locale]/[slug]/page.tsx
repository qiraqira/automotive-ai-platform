import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, buildArticleJsonLd, safeJsonLdString, type Locale } from "@automotive/seo";
import { getArticle } from "@/lib/api";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const SITE_NAME = process.env.PROJECT_NAME ?? "PROJECT_NAME";

function isLocale(value: string): value is Locale {
  return value === "en" || value === "es";
}

// Uploaded hero images (apps/worker/src/generate-image.ts, the manual
// upload flow) store a site-relative URL (`/uploads/x.png`); Commons
// hero images are already absolute. Open Graph/Twitter Card `image`
// values are expected to be absolute — a relative `og:image` is silently
// ignored or mis-resolved by real crawlers (verified against Open
// Graph's own protocol docs before relying on this).
function absoluteUrl(url: string): string {
  return url.startsWith("http") ? url : `${SITE_URL}${url}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const article = await getArticle(locale, slug);
  const path = `/articles/${locale}/${slug}`;
  const alternates = buildHreflangAlternates(SITE_URL, path);
  if (!article) {
    return {
      alternates: {
        canonical: buildLocaleUrl(SITE_URL, locale, path),
        languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
      },
    };
  }

  const canonicalUrl = buildLocaleUrl(SITE_URL, locale, path);
  const imageUrl = article.images[0] ? absoluteUrl(article.images[0].image.originalUrl) : undefined;

  // 2026-09-11: a retroactive quality-gate pass found ~65% of the
  // published corpus contains fabricated/unsupported claims beyond what
  // their cited sources say (see apps/api/src/app.ts's own comment on
  // this same finding). Unpublishing all of them at once would 404 a
  // large batch of already-indexed URLs; noindex keeps the URL and its
  // link equity alive while pulling it out of search until it's
  // rewritten or deliberately removed.
  const robots = article.qualityVerdict === "reject" ? { index: false, follow: false } : undefined;

  // Real, live-discovered gap found 2026-09-09 (user directly asked "will
  // Google rank this?" while reviewing the site): this page had zero
  // Open Graph/Twitter Card tags — real, meaningful for both social-share
  // unfurls and as a fallback signal several crawlers use. `article:*`
  // isn't a Next.js Metadata API first-class field, so it's expressed via
  // `openGraph.type: "article"` plus `openGraph`'s own
  // `publishedTime`/`modifiedTime` (Next maps these to the standard
  // `article:published_time`/`article:modified_time` meta tags).
  return {
    title: article.headline,
    description: article.subtitle ?? undefined,
    alternates: {
      canonical: canonicalUrl,
      languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
    },
    robots,
    openGraph: {
      type: "article",
      title: article.headline,
      description: article.subtitle ?? undefined,
      url: canonicalUrl,
      siteName: SITE_NAME,
      publishedTime: article.publishedAt ?? undefined,
      images: imageUrl ? [{ url: imageUrl }] : undefined,
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title: article.headline,
      description: article.subtitle ?? undefined,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

// The first real page rendering apps/worker/src/write-article.ts's real
// AI-written Article rows — MVP scope: headline/subtitle/keyTakeaway plus
// ordered TEXT blocks (the only ArticleBlockType the Writer stage
// produces today; FACT_TABLE/SPEC_TABLE/etc. render once a real stage
// produces them, not faked here). `authorType` is always shown, not
// hidden — spec's own AI-transparency principle (see /about/how-we-use-ai)
// applies to the very first article this platform ever published, not
// just a future polished version.
export default async function ArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const article = await getArticle(locale, slug);
  if (!article) notFound();

  const pageUrl = `${SITE_URL}/articles/${locale}/${slug}`;
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: article.headline, url: pageUrl },
  ]);
  // Real gap closed 2026-09-09 (see generateMetadata's own comment) —
  // layout.tsx's original note deferred this specifically until "a real
  // article or a real photo exists to describe"; both do now.
  const articleJsonLd = buildArticleJsonLd({
    headline: article.headline,
    description: article.subtitle ?? undefined,
    imageUrl: article.images[0] ? absoluteUrl(article.images[0].image.originalUrl) : undefined,
    datePublished: article.publishedAt ?? new Date().toISOString(),
    url: pageUrl,
    authorName: SITE_NAME,
    publisherName: SITE_NAME,
  });

  return (
    <article>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(articleJsonLd) }}
      />
      <div className="story-meta">
        {article.authorType === "AI_AGENT" ? (
          <>
            <span className="badge">AI-written</span> — see <Link href="/about/how-we-use-ai">how we use AI</Link>
          </>
        ) : (
          article.authorType
        )}
        {article.publishedAt ? ` · ${new Date(article.publishedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}` : ""}
      </div>
      <h1 style={{ fontSize: 32, margin: "4px 0 8px" }}>{article.headline}</h1>
      {article.subtitle && <p style={{ fontSize: 18, color: "var(--ink-dim)", margin: "0 0 24px" }}>{article.subtitle}</p>}

      {article.images[0] && (
        <figure style={{ margin: "0 0 24px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>
              deliberately, see next.config.mjs's own comment on why this
              app skips next/image */}
          <img
            src={article.images[0].image.originalUrl}
            alt={article.images[0].altText ?? article.headline}
            width={article.images[0].image.width ?? undefined}
            height={article.images[0].image.height ?? undefined}
            style={{ width: "100%", height: "auto", display: "block" }}
          />
          {article.images[0].image.attribution && (
            <figcaption className="story-meta" style={{ marginTop: 4 }}>
              {article.images[0].image.attribution}
            </figcaption>
          )}
        </figure>
      )}

      {article.keyTakeaway && (
        <div className="story-item" style={{ marginBottom: 24 }}>
          <strong>Key takeaway:</strong> {article.keyTakeaway}
        </div>
      )}

      {article.blocks.map((block) =>
        block.type === "TEXT" && block.data.text ? (
          <p key={block.id} style={{ marginBottom: 16, lineHeight: 1.6 }}>
            {block.data.text}
          </p>
        ) : null,
      )}

      {article.story && (
        // No standalone Story detail page exists yet (see README's status
        // table) — shown as plain text rather than a fabricated link.
        <p className="story-meta" style={{ marginTop: 32 }}>
          Original coverage: {article.story.title}
        </p>
      )}

      {article.citations.length > 0 && (
        // Real gap found and fixed 2026-09-09, user's explicit request:
        // this section didn't exist at all — apps/worker/src/
        // write-article.ts now creates a real Citation per real
        // SourceArticle used to write the piece (see that file's own
        // comment), and this renders them as real outbound links, not a
        // fabricated "sources" list. Deliberately `rel="nofollow"`: this
        // isn't editorial endorsement of the linked outlet, just honest
        // attribution.
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)" }}>Sources</h2>
          <ul>
            {article.citations.map((citation) => (
              <li key={citation.id}>
                <a href={citation.url} target="_blank" rel="nofollow noopener noreferrer">
                  {citation.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
