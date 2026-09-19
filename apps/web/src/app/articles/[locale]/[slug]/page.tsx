import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, buildArticleJsonLd, safeJsonLdString, type Locale } from "@automotive/seo";
import { getArticle } from "@/lib/api";
import EditorialDisclosure from "@/components/EditorialDisclosure";
import CinematicVideo from "@/components/CinematicVideo";
import { clampedAspectRatio, pairedAspectRatio } from "@/lib/image-aspect";

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
// ordered TEXT blocks (the only ArticleBlockType the real-time News
// Writer stage produces) and, since 2026-09-11, SPEC_TABLE (the hand-
// authored evergreen content in apps/worker/src/seed-real-articles.ts
// is this block type's first real user). FACT_TABLE/TIMELINE/etc. still
// render as nothing — not faked here — until a real caller writes one.
// `authorType` is always shown, not hidden — spec's own AI-transparency
// principle (see /about/how-we-use-ai) applies to the very first article
// this platform ever published, not just a future polished version.
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
    // Real gap found and fixed 2026-09-17 (user's own question about
    // Google News readiness): this was never set, so every Article/
    // NewsArticle's publisher had no logo at all in structured data.
    // apps/web/src/app/apple-icon.tsx already generates a real 180x180
    // PNG of the site's own mark (next/og, no separate asset needed) —
    // reused here rather than building a second logo image.
    publisherLogoUrl: `${SITE_URL}/apple-icon`,
    // See buildArticleJsonLd's own comment: only genuinely time-sensitive
    // news content claims NewsArticle; GUIDE/COMPARISON/ANALYSIS/etc. are
    // evergreen and get plain Article.
    schemaType: article.type === "NEWS" || article.type === "BREAKING_NEWS" ? "NewsArticle" : "Article",
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
        {article.authorType === "AI_AGENT" || article.authorType === "HYBRID" ? (
          <EditorialDisclosure />
        ) : (
          article.authorType
        )}
        {article.publishedAt ? ` · ${new Date(article.publishedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}` : ""}
      </div>
      <h1 style={{ fontSize: 32, margin: "4px 0 8px" }}>{article.headline}</h1>
      {article.subtitle && <p style={{ fontSize: 18, color: "var(--ink-dim)", margin: "0 0 24px" }}>{article.subtitle}</p>}

      {(() => {
        // Side-by-side hero (2026-09-14), user's own explicit ask: a
        // comparison article almost never has one real photo with both
        // compared cars in frame, so a single hero photo can only ever
        // favor one side. publish-manual-article.ts's heroImagePair
        // attaches two HERO-role images (position 0 and 1) for exactly
        // this case; a single-subject article still attaches one HERO
        // image, so this falls through to the original full-width figure.
        const heroImages = article.images.filter((img) => img.role === "HERO");
        if (heroImages.length >= 2) {
          const [left, right] = heroImages;
          // Shared ratio, not each image's own — user's own direct
          // complaint, this exact pair (Tesla Model 3 vs. Toyota
          // Corolla): two independently-clamped ratios put two real
          // photos of different real shapes at two different heights
          // side by side, which reads as a layout bug even though
          // neither photo was individually cropped or letterboxed. See
          // pairedAspectRatio's own comment for why averaging is the
          // fix, not picking one side's shape for both.
          const sharedRatio = String(pairedAspectRatio(left.image, right.image));
          return (
            <figure style={{ margin: "0 0 24px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[left, right].map((img) => (
                  // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
                  <img
                    key={img.image.originalUrl}
                    src={img.image.originalUrl}
                    alt={img.altText ?? article.headline}
                    // No-crop fix (2026-09-15): "cover" cut real
                    // content off real photos to fill the tile.
                    style={{
                      width: "100%",
                      aspectRatio: sharedRatio,
                      objectFit: "contain",
                      background: "var(--surface-alt, rgba(128,128,128,0.06))",
                      display: "block",
                    }}
                  />
                ))}
              </div>
              {(left.image.attribution || right.image.attribution) && (
                <figcaption className="story-meta" style={{ marginTop: 4 }}>
                  {[left.image.attribution, right.image.attribution].filter(Boolean).join(" · ")}
                </figcaption>
              )}
            </figure>
          );
        }
        if (!heroImages[0]) return null;
        return (
          <figure style={{ margin: "0 0 24px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>
                deliberately, see next.config.mjs's own comment on why this
                app skips next/image */}
            <img
              src={heroImages[0].image.originalUrl}
              alt={heroImages[0].altText ?? article.headline}
              width={heroImages[0].image.width ?? undefined}
              height={heroImages[0].image.height ?? undefined}
              style={{ width: "100%", height: "auto", display: "block" }}
            />
            {heroImages[0].image.attribution && (
              <figcaption className="story-meta" style={{ marginTop: 4 }}>
                {heroImages[0].image.attribution}
              </figcaption>
            )}
          </figure>
        );
      })()}

      {article.keyTakeaway && (
        <div className="story-item" style={{ marginBottom: 24 }}>
          <strong>Key takeaway:</strong> {article.keyTakeaway}
        </div>
      )}

      {(() => {
        // Real redesign 2026-09-14, user's own explicit ask after
        // reading a live comparison piece: every GALLERY photo used to
        // land in one flat grid before the body text even started,
        // completely disconnected from what the text was actually
        // discussing at that point — "скучный текст" with pictures
        // parked off to the side, not pictures that go WITH the
        // reading. Checked the actual research before changing this
        // rather than guessing: Nielsen Norman Group's own carousel
        // usability data (only ~1% of visitors interact with a
        // carousel's first slide, engagement drops roughly 30% versus
        // static content) rules out a click-through switcher as the
        // fix; separate "scrollytelling"/long-form-engagement research
        // instead supports images interspersed through the body text
        // itself, breaking up long stretches of prose rather than
        // clustering photos in one block a reader can skip past
        // entirely. So: gallery photos are now spread evenly through
        // the TEXT blocks instead of grouped in their own section — a
        // comparison piece's own photo order (this project's own
        // convention: each subject's photos in the order it's
        // discussed) now roughly lines up with which car the nearby
        // paragraphs are actually about, without needing new per-photo
        // "which paragraph" metadata this schema doesn't have.
        const galleryImages = article.images.filter((img) => img.role === "GALLERY");
        const textBlockCount = article.blocks.filter((b) => b.type === "TEXT" && b.data.text).length;
        // Standard even-spacing-of-M-dividers-among-N-items formula: for
        // gallery image index i (0-based) of M total, insert it after
        // the text block at this 0-based index.
        const insertAfterTextIndex = new Map<number, typeof galleryImages>();
        galleryImages.forEach((img, i) => {
          const afterIndex = Math.min(textBlockCount - 1, Math.round(((i + 1) * textBlockCount) / (galleryImages.length + 1)) - 1);
          if (afterIndex < 0) return;
          const existing = insertAfterTextIndex.get(afterIndex) ?? [];
          existing.push(img);
          insertAfterTextIndex.set(afterIndex, existing);
        });

        // Real gap found and fixed 2026-09-11 (first real use on the BMW
        // X5 vs GLE rebuild): every linked CarModel already has real
        // OFFICIAL/CRASH_TEST video on its own model page (see GET
        // /v1/articles's own comment) — a comparison piece is exactly
        // where a reader most wants to see both cars' own official
        // trailer and Euro NCAP footage side by side, not just a link
        // away to each model page separately.
        //
        // Changed from .some() to .every(), 2026-09-16 — user's own
        // direct catch: this rendered as soon as ANY linked car had a
        // video, so a pair where only one side had curated footage
        // showed a one-sided "Compare on video" section that read as
        // implicitly favoring whichever car happened to have one. A
        // real comparison either shows both sides on video or shows
        // neither — see memory/comparison-article-video-balance.md.
        //
        // Moved from below the SPEC_TABLE up to right after the first
        // paragraph, 2026-09-19 (user's own ask): by the end of a
        // comparison's opening paragraph the reader already knows why
        // these two cars are being set against each other, so the video
        // now lands as soon as that context exists instead of being
        // buried under the whole text body — more of a "moment" early
        // in the read, not an afterthought at the end.
        //
        // Split into two separate full-width "moments" instead of one
        // side-by-side grid, 2026-09-19 (same-day follow-up, user's own
        // ask): a two-up grid squeezes each video down to column width,
        // and showing both cars back-to-back in one spot isn't actually
        // more useful than seeing each large, on its own, spaced through
        // the read the same way gallery photos already are above. Each
        // linked car's video(s) render full width (no grid wrapper) and
        // land after a different paragraph — the first car right after
        // the intro, the next two paragraphs later — rather than all
        // bunched into the same spot.
        const videosByTextIndex = new Map<number, { carModel: (typeof article.carModels)[number]["carModel"]; video: (typeof article.carModels)[number]["carModel"]["videos"][number] }[]>();
        if (article.carModels.length > 0 && article.carModels.every(({ carModel }) => carModel.videos.length > 0)) {
          article.carModels.forEach(({ carModel }, carIndex) => {
            const afterIndex = Math.min(textBlockCount - 1, carIndex * 2);
            if (afterIndex < 0) return;
            const existing = videosByTextIndex.get(afterIndex) ?? [];
            for (const video of carModel.videos) existing.push({ carModel, video });
            videosByTextIndex.set(afterIndex, existing);
          });
        }

        let textBlockIndex = -1;
        return article.blocks.map((block) => {
          const elements: ReactNode[] = [];

          if (block.type === "TEXT" && block.data.text) {
            textBlockIndex += 1;
            elements.push(
              <p key={block.id} style={{ marginBottom: 16, lineHeight: 1.6 }}>
                {block.data.text}
              </p>,
            );
            for (const { carModel, video } of videosByTextIndex.get(textBlockIndex) ?? []) {
              elements.push(
                <div key={`${block.id}-video-${video.youtubeId}`} style={{ margin: "8px 0 24px" }}>
                  <CinematicVideo
                    youtubeId={video.youtubeId}
                    title={video.title}
                    label={`${carModel.brand.name} ${carModel.name} — ${video.category === "OFFICIAL" ? "Official video" : "Euro NCAP crash test"}`}
                  />
                  <p className="story-meta" style={{ margin: "8px 0 0" }}>
                    <Link href={`/cars/${carModel.brand.slug}/${carModel.slug}`}>
                      See the {carModel.brand.name} {carModel.name}&apos;s real specs and trims →
                    </Link>
                  </p>
                </div>,
              );
            }
            for (const img of insertAfterTextIndex.get(textBlockIndex) ?? []) {
              elements.push(
                <figure key={`${block.id}-img-${img.image.originalUrl}`} style={{ margin: "8px 0 24px" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment */}
                  <img
                    src={img.image.originalUrl}
                    alt={img.altText ?? article.headline}
                    // No-crop fix (2026-09-15): "cover" cut real
                    // content off real photos to fill the tile.
                    // Ratio itself fixed 2026-09-16 — see the two-up
                    // hero pair above for why a flat ratio letterboxed.
                    style={{
                      width: "100%",
                      aspectRatio: String(clampedAspectRatio(img.image.width, img.image.height)),
                      objectFit: "contain",
                      background: "var(--surface-alt, rgba(128,128,128,0.06))",
                      borderRadius: 4,
                      display: "block",
                    }}
                  />
                  {img.image.attribution && (
                    <figcaption className="story-meta" style={{ marginTop: 4, fontSize: 11 }}>
                      {img.image.attribution}
                    </figcaption>
                  )}
                </figure>,
              );
            }
          }

          // Real gap closed 2026-09-11: ArticleBlockType.SPEC_TABLE existed
          // in the schema since it first landed, but nothing ever rendered
          // it — every COMPARISON article had to be written as prose-only
          // TEXT blocks, even though a side-by-side spec table is exactly
          // what a comparison piece should lead with. First real renderer,
          // first real block using it (seed-real-articles.ts's BMW X5 vs
          // Mercedes GLE piece).
          if (block.type === "SPEC_TABLE" && block.data.headers && block.data.rows) {
            const { headers, rows } = block.data;
            elements.push(
              <div key={block.id} style={{ overflowX: "auto", marginBottom: 24 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "6px 12px 6px 0", borderBottom: "2px solid var(--line)" }} />
                      {headers.map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "6px 12px", borderBottom: "2px solid var(--line)" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label}>
                        <td style={{ padding: "6px 12px 6px 0", fontWeight: 700, borderBottom: "1px solid var(--line)" }}>{row.label}</td>
                        {row.values.map((v, i) => (
                          <td key={i} style={{ padding: "6px 12px", borderBottom: "1px solid var(--line)" }}>
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>,
            );
          }

          // Added 2026-09-16, user's own ask: a real official YouTube
          // video placed inline in the article body itself, wherever the
          // writer chose to put it — distinct from the auto-generated
          // "Compare on video" section (pushed right after the first
          // paragraph above, which only ever pulls each linked CarModel's
          // own curated videos). Reuses CinematicVideo.tsx, same real-
          // video component the homepage/car pages already use.
          if (block.type === "VIDEO" && block.data.youtubeId && block.data.title) {
            elements.push(
              <div key={block.id} style={{ margin: "8px 0 24px" }}>
                <CinematicVideo youtubeId={block.data.youtubeId} title={block.data.title} label={block.data.label} />
              </div>,
            );
          }

          return elements;
        });
      })()}

      {article.story && (
        // No standalone Story detail page exists yet (see README's status
        // table) — shown as plain text rather than a fabricated link.
        <p className="story-meta" style={{ marginTop: 32 }}>
          Original coverage: {article.story.title}
        </p>
      )}

      {article.carModels.length > 0 && (
        // Real gap found and fixed 2026-09-11: ArticleCarModel has real
        // data (entity-extractor.ts auto-links a NEWS article to a
        // CarModel it precisely names; this project's COMPARISON
        // articles link explicitly) but nothing ever rendered it — zero
        // "Related cars" internal linking despite the data existing.
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)" }}>Related cars</h2>
          <ul>
            {article.carModels.map(({ carModel }) => (
              <li key={`${carModel.brand.slug}-${carModel.slug}`}>
                <Link href={`/cars/${carModel.brand.slug}/${carModel.slug}`}>
                  {carModel.brand.name} {carModel.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {article.relatedArticles.length > 0 && (
        // Real gap found and fixed 2026-09-11: this file's own hand-
        // written prose (seed-real-articles.ts's ANALYSIS/GUIDE/
        // COMPARISON pieces) repeatedly wrote lines like "(see this
        // site's own analysis of...)" — but a TEXT block renders as
        // plain text, so none of those mentions were ever clickable.
        // Backed by a real EntityRelation edge, not by parsing the
        // prose for a matching phrase.
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)" }}>Related articles</h2>
          <ul>
            {article.relatedArticles.map((related) => (
              <li key={related.slug}>
                <Link href={`/articles/${related.locale}/${related.slug}`}>{related.headline}</Link>
              </li>
            ))}
          </ul>
        </div>
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
