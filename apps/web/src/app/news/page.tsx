import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getStories } from "@/lib/api";
import { rankStories } from "@/lib/ranking";
import { isLogoImage, LeadMedia } from "@/components/ArticleMedia";
import { ContentCard } from "@/components/ContentCard";

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
//
// Premium redesign, 2026-09-17 — user's own direct ask ("news и гайды
// тоже современно надо сделать с большой новостью"), same pattern as
// /comparisons and /topics/[slug]: the newest story as a large featured
// hero card (page 1 only — "the latest story" doesn't mean anything on
// page 2+), the rest in the same ContentCard grid.
export default async function NewsIndexPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { stories: unranked, hasMore } = await getStories({ limit: PAGE_SIZE, offset, hasArticle: true });
  const stories = rankStories(unranked);
  const [featured, ...rest] = page === 1 ? stories : [undefined, ...stories];

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
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 6 }}>
        News
      </div>
      <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(26px, 3.5vw, 36px)", fontWeight: 800, margin: "0 0 32px", lineHeight: 1.15 }}>
        Every published story, newest first
      </h1>

      {featured && (
        <Link
          href={featured.articles[0] ? `/articles/en/${featured.articles[0].slug}` : "/news"}
          className="premium-card"
          style={{ display: "block", marginBottom: 40 }}
        >
          <LeadMedia
            images={featured.articles[0]?.images ?? []}
            isLogo={isLogoImage(featured.articles[0]?.images ?? [])}
            fallbackAlt={featured.articles[0]?.headline ?? featured.title}
            width="100%"
            borderRadius={0}
            marginBottom={0}
          />
          <div style={{ padding: "24px 28px 28px" }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 10 }}>
              Latest story
            </div>
            {/* Real bug found and fixed 2026-09-19, user's own direct
                catch: always showed the raw `story.title` even once a
                real, edited Article existed with its own headline. */}
            <h2 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(22px, 2.6vw, 30px)", fontWeight: 800, margin: "0 0 12px", lineHeight: 1.2 }}>
              {featured.articles[0]?.headline ?? featured.title}
            </h2>
            <div className="story-meta">
              {featured._count.sourceArticles} source{featured._count.sourceArticles === 1 ? "" : "s"}
              {featured.sources[0] ? ` · via ${featured.sources[0].source.name}` : ""}
              {featured.primaryTopic ? ` · ${featured.primaryTopic.name}` : ""}
            </div>
          </div>
        </Link>
      )}

      {rest.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
          {rest.map((story) => {
            if (!story) return null;
            const images = story.articles[0]?.images ?? [];
            const displayTitle = story.articles[0]?.headline ?? story.title;
            return (
              <ContentCard
                key={story.id}
                href={story.articles[0] ? `/articles/en/${story.articles[0].slug}` : "/news"}
                images={images}
                isLogo={isLogoImage(images)}
                fallbackAlt={displayTitle}
                badge={story.primaryTopic?.name ?? "News"}
                title={displayTitle}
              />
            );
          })}
        </div>
      )}
      {stories.length === 0 && <p>No stories on this page.</p>}

      <div style={{ display: "flex", gap: 16, marginTop: 32 }}>
        {page > 1 && (
          <Link href={page === 2 ? "/news" : `/news?page=${page - 1}`} style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            ← Newer
          </Link>
        )}
        {hasMore && (
          <Link href={`/news?page=${page + 1}`} style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            Older →
          </Link>
        )}
      </div>
    </section>
  );
}
