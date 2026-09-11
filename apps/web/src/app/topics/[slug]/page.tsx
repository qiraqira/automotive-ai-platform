import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getTopic } from "@/lib/api";

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
export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getTopic(slug);
  if (!result) notFound();
  const { topic, stories } = result;

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
      <h1 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)" }}>
        Topic
      </h1>
      <h2 style={{ fontSize: 28, margin: "4px 0 20px" }}>{topic.name}</h2>
      <ul className="story-list">
        {stories.map((story) => {
          const heroUrl = story.articles[0]?.images[0]?.image.originalUrl;
          // Brand-logo fallback (fetch-images.ts's EDITORIAL_ONLY path) is usually
          // square/circular — objectFit: "cover" in this landscape box crops it.
          // Most real logo fallbacks on production come through the generic
          // Commons/Openverse search matching a "*logo*" filename rather than
          // the deliberate brand-logo path, so rightsStatus alone misses most
          // of them — the filename match catches those too.
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
                    objectFit: isLogo ? "contain" : "cover",
                    background: isLogo ? "#fff" : undefined,
                    padding: isLogo ? 8 : undefined,
                    flexShrink: 0,
                    borderRadius: 4,
                  }}
                />
              )}
              <div>
                <div className="story-meta">
                  {story.status} · {story._count.sourceArticles} source{story._count.sourceArticles === 1 ? "" : "s"}
                  {story.sources[0] ? ` · via ${story.sources[0].source.name}` : ""}
                </div>
                <h2>{story.articles[0] ? <Link href={`/articles/en/${story.articles[0].slug}`}>{story.title}</Link> : story.title}</h2>
              </div>
            </li>
          );
        })}
        {stories.length === 0 && <p>No stories classified under this topic yet.</p>}
      </ul>
    </section>
  );
}
