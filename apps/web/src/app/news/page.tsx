import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getStories } from "@/lib/api";
import { rankStories } from "@/lib/ranking";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const PAGE_SIZE = 24;

export async function generateMetadata(): Promise<Metadata> {
  const path = "/news";
  const alternates = buildHreflangAlternates(SITE_URL, path);
  return {
    // "Auto News" (2026-09-14, same keyword-core pass as the homepage's
    // own HOME_TITLE) rather than the bare "News" — matches how a reader
    // actually searches, and this page is exactly that: every published
    // auto news story.
    title: "Auto News",
    description: "Every published auto news story on this site, newest first — real reporting, sourced and checked before it's written up.",
    alternates: {
      canonical: buildLocaleUrl(SITE_URL, "en", path),
      languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
    },
  };
}

// Real gap found and fixed 2026-09-11, user's own explicit request: the
// homepage's "Latest news" section sliced to 8 stories with no way to
// reach the other 100+ real published news articles — the exact "no
// dead ends" gap /guides and /brands already avoided with their own
// index pages, just never extended to news once the homepage stopped
// being a full chronological feed. Real offset-based pagination (GET
// /v1/stories already supports it) rather than a single giant list —
// this site has no infinite-scroll/client-pagination anywhere else
// either, so a plain `?page=N` GET link matches the same "no client JS
// required" convention as /search's own form.
export default async function NewsIndexPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { stories: unranked, hasMore } = await getStories({ limit: PAGE_SIZE, offset, hasArticle: true });
  const stories = rankStories(unranked);

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: "News", url: `${SITE_URL}/news` },
  ]);

  return (
    <section>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)" }}>
        News
      </h2>
      <h1 style={{ fontSize: 28, margin: "4px 0 20px" }}>Every published story, newest first</h1>

      <ul className="story-list">
        {stories.map((story) => {
          const heroUrl = story.articles[0]?.images[0]?.image.originalUrl;
          const isLogo =
            story.articles[0]?.images[0]?.image.rightsStatus === "EDITORIAL_ONLY" || (heroUrl?.toLowerCase().includes("logo") ?? false);
          return (
            <li key={story.id} className="story-item" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {heroUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
                <img
                  src={heroUrl}
                  alt=""
                  style={{
                    width: 96,
                    height: 64,
                    // No-crop fix (2026-09-15): "cover" cut real
                    // content off real photos to fill the box.
                    objectFit: "contain",
                    background: isLogo ? "#fff" : "var(--surface-alt, rgba(128,128,128,0.06))",
                    padding: isLogo ? 8 : undefined,
                    flexShrink: 0,
                    borderRadius: 4,
                  }}
                />
              )}
              <div>
                <div className="story-meta">
                  {story._count.sourceArticles} source{story._count.sourceArticles === 1 ? "" : "s"}
                  {story.sources[0] ? ` · via ${story.sources[0].source.name}` : ""}
                  {story.primaryTopic ? (
                    <>
                      {" · "}
                      <Link href={`/topics/${story.primaryTopic.slug}`}>{story.primaryTopic.name}</Link>
                    </>
                  ) : null}
                </div>
                <h3 style={{ fontSize: 18, margin: 0 }}>
                  {story.articles[0] ? <Link href={`/articles/en/${story.articles[0].slug}`}>{story.title}</Link> : story.title}
                </h3>
              </div>
            </li>
          );
        })}
        {stories.length === 0 && <p>No stories on this page.</p>}
      </ul>

      <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
        {page > 1 && <Link href={page === 2 ? "/news" : `/news?page=${page - 1}`}>← Newer</Link>}
        {hasMore && <Link href={`/news?page=${page + 1}`}>Older →</Link>}
      </div>
    </section>
  );
}
