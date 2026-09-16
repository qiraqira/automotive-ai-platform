import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getTopic } from "@/lib/api";
import { isLogoImage, LeadMedia } from "@/components/ArticleMedia";
import { ContentCard } from "@/components/ContentCard";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await getTopic(slug);
  const path = `/topics/${slug}`;
  const alternates = buildHreflangAlternates(SITE_URL, path);
  return {
    title: result ? `${result.topic.name} — Latest Stories` : undefined,
    // SEO pass (2026-09-11): real gap — this page had a title but no
    // description at all, so every topic page's search snippet fell
    // back to the site-wide default, identical regardless of which
    // topic it was.
    description: result ? `The latest ${result.topic.name.toLowerCase()} news and analysis, updated as new stories are verified and published.` : undefined,
    alternates: {
      canonical: buildLocaleUrl(SITE_URL, "en", path),
      languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
    },
  };
}

// Real per-Topic feed, driven by Story.primaryTopicId (set at ingestion
// time by packages/editorial's rule-based classifyTopic() — the
// Classifier pipeline stage's stand-in until an AI classifier exists).
// Ordered by lastUpdatedAt, not computeRankingScore(): a topic page is a
// "what's new here" list, not a ranked front page.
//
// Premium redesign, 2026-09-17 — user's own direct ask ("все топики как
// этот и так далее тоже сделай главную новость главной", pointing at the
// already-redesigned /comparisons page) to bring every topic page in
// line with that same pattern rather than leaving it on the old plain
// `<ul className="story-list">` layout: the newest story as a large
// featured hero card, the rest in the same ContentCard grid the
// homepage/comparisons pages use. The "Analysis & guides" section below
// (real evergreen Articles tagged directly with this Topic — see
// TopicArticleSummary's own comment) gets the same card-grid treatment.
export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getTopic(slug);
  if (!result) notFound();
  const { topic, stories, articles } = result;
  const [featured, ...restStories] = stories;
  const featuredImages = featured?.articles[0]?.images ?? [];

  // spec §29: real BreadcrumbList — same reasoning as the car page (see
  // its own comment), no fabricated "/topics" index page since none
  // exists.
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: topic.name, url: `${SITE_URL}/topics/${slug}` },
  ]);

  return (
    <section>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 6 }}>
        Topic
      </div>
      <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(26px, 3.5vw, 36px)", fontWeight: 800, margin: "0 0 32px", lineHeight: 1.15 }}>
        {topic.name}
      </h1>

      {featured && (
        // Stacked (photo on top, text below) — same layout the
        // /comparisons hero card settled on 2026-09-17 after the user's
        // own direct correction there.
        <Link
          href={featured.articles[0] ? `/articles/en/${featured.articles[0].slug}` : "#"}
          className="premium-card"
          style={{ display: "block", marginBottom: 40, pointerEvents: featured.articles[0] ? "auto" : "none" }}
        >
          <div style={{ position: "relative" }}>
            <LeadMedia images={featuredImages} isLogo={isLogoImage(featuredImages)} fallbackAlt={featured.title} width="100%" borderRadius={0} marginBottom={0} />
          </div>
          <div style={{ padding: "24px 28px 28px" }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 10 }}>
              Latest story
            </div>
            <h2 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(22px, 2.6vw, 30px)", fontWeight: 800, margin: "0 0 12px", lineHeight: 1.2 }}>
              {featured.title}
            </h2>
            {featured.summary && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--ink-dim)", lineHeight: 1.6, margin: "0 0 18px" }}>{featured.summary}</p>
            )}
            <div className="story-meta">
              {featured.status} · {featured._count.sourceArticles} source{featured._count.sourceArticles === 1 ? "" : "s"}
              {featured.sources[0] ? ` · via ${featured.sources[0].source.name}` : ""}
            </div>
          </div>
        </Link>
      )}

      {restStories.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24, marginBottom: articles.length > 0 ? 48 : 0 }}>
          {restStories.map((story) => {
            const images = story.articles[0]?.images ?? [];
            return (
              <ContentCard
                key={story.id}
                href={story.articles[0] ? `/articles/en/${story.articles[0].slug}` : `/topics/${slug}`}
                images={images}
                isLogo={isLogoImage(images)}
                fallbackAlt={story.title}
                badge={story.primaryTopic?.name ?? "News"}
                title={story.title}
                description={story.summary}
              />
            );
          })}
        </div>
      )}

      {stories.length === 0 && <p>No stories classified under this topic yet.</p>}

      {articles.length > 0 && (
        // Real gap found and fixed 2026-09-11: evergreen content
        // (comparisons, analysis, guides) has no Story and so never
        // showed up above no matter how relevant it is to this Topic —
        // see Article.topicId's own schema comment for why a Story-only
        // feed missed this real category of content entirely.
        <>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 20 }}>
            Analysis &amp; guides
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
            {articles.map((article) => (
              <ContentCard
                key={article.slug}
                href={`/articles/en/${article.slug}`}
                images={article.images}
                isLogo={isLogoImage(article.images)}
                fallbackAlt={article.headline}
                badge={article.type}
                title={article.headline}
                description={article.subtitle}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
