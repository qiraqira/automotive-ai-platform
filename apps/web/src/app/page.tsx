import type { Metadata } from "next";
import Link from "next/link";
import { computeRankingScore } from "@automotive/editorial";
import { buildHreflangAlternates, buildLocaleUrl } from "@automotive/seo";
import { getStories, getTopic, getTopicSlugs, type StorySummary, type TopicWithStories } from "@/lib/api";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// spec §22/§30: the homepage needs the same real hreflang/canonical as
// the car page (packages/seo) — previously only the car page had it,
// which was an inconsistency, not a deliberate scope cut.
export const metadata: Metadata = {
  alternates: {
    canonical: buildLocaleUrl(SITE_URL, "en", ""),
    languages: Object.fromEntries(buildHreflangAlternates(SITE_URL, "").map((a) => [a.hreflang, a.href])),
  },
};

// Homepage: a "Latest" feed ordered by the real computeRankingScore()
// (spec §95), plus one section per real Topic underneath (spec §33/§66's
// Breaking/Top Stories/EV/Market/... layout, in the one honest form it can
// take today). Only sections with at least one real classified Story
// render — a topic with zero stories would be an empty box, which is
// exactly the "fake structure with no real data behind it" spec §85 rules
// out just as much as a fake button. Full section variety (Cars/Tech/
// Trending) still waits on more topic rules / entities existing; this is
// everything that's honestly supportable right now, not a placeholder.
// Real gap found and fixed 2026-09-08: this used Promise.all, so a
// single topic's fetch failing (a real, plausible transient issue — a
// slow query, a brief apps/api hiccup — not exotic; getTopic() throws for
// any non-404 failure) took down the ENTIRE homepage, including the
// "Latest" feed above, which is otherwise completely independent and had
// already succeeded via the other half of the outer Promise.all below.
// This function already treats an ABSENT topic the same as an empty one
// (filtered out, no fake empty box) — extending that same tolerance to a
// topic whose fetch failed is the same posture, not a new one: readers
// still get every section that actually loaded instead of a blank/broken
// page over one transient failure elsewhere. Logged server-side (not
// silently swallowed) so a genuinely persistent failure is still visible
// in the same structured stdout logs every other real error in this app
// already uses.
async function getTopicSections() {
  const { topics } = await getTopicSlugs();
  const results = await Promise.allSettled(topics.map((t) => getTopic(t.slug)));
  const sections: TopicWithStories[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "homepage_topic_section_failed", reason: String(result.reason) }));
      continue;
    }
    if (result.value !== null && result.value.stories.length > 0) {
      sections.push(result.value);
    }
  }
  return sections;
}

function averageSourceTrust(story: StorySummary): number {
  if (story.sources.length === 0) return 50;
  const total = story.sources.reduce((sum, s) => sum + s.source.trustScore, 0);
  return total / story.sources.length;
}

function rankStories(stories: StorySummary[]): StorySummary[] {
  const now = new Date();
  return [...stories].sort((a, b) => {
    const scoreA = computeRankingScore({
      importanceScore: a.importanceScore,
      sourceQualityScore: averageSourceTrust(a),
      publishedAt: new Date(a.lastUpdatedAt),
      now,
    });
    const scoreB = computeRankingScore({
      importanceScore: b.importanceScore,
      sourceQualityScore: averageSourceTrust(b),
      publishedAt: new Date(b.lastUpdatedAt),
      now,
    });
    return scoreB - scoreA;
  });
}

export default async function HomePage() {
  // Real gap found and fixed 2026-09-09, user's explicit request: this
  // used to fetch ANY Story regardless of whether the Writer stage had
  // produced a real Article for it yet — confirmed live that 19 of the
  // real top 20 (by lastUpdatedAt) were raw, just-ingested stubs with
  // nothing real to read, prominently listed on the homepage anyway
  // (unlinked, per the `story.articles[0] ? Link : plain text` guard
  // below, but still occupying the "Latest" feed's real estate). The
  // reader's actual workflow should be ingest -> write -> quality gate
  // -> publish, in that order, before anything shows up here — not
  // ingest -> immediately show. `hasArticle: true` is the real fix.
  const [{ stories: unranked }, topicSections] = await Promise.all([getStories({ limit: 20, hasArticle: true }), getTopicSections()]);
  const stories = rankStories(unranked);

  return (
    <>
      <section>
        <h1 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)" }}>
          Latest
        </h1>
        <ul className="story-list">
          {stories.map((story) => {
            const heroUrl = story.articles[0]?.images[0]?.image.originalUrl;
            // A brand-logo fallback (see fetch-images.ts's EDITORIAL_ONLY path) is
            // usually square/circular with padding baked in — objectFit: "cover"
            // in this landscape 96x64 box crops its edges off. Show it whole
            // instead, on a neutral ground since many logo files have a
            // transparent background. Checked live 2026-09-11: most of these
            // logo fallbacks on production actually have rightsStatus other
            // than EDITORIAL_ONLY (they came through the generic Commons/
            // Openverse photo search matching a "*logo*" file by title, not
            // through attachHeroImage's deliberate brand-logo path) — so the
            // rightsStatus check alone misses ~75% of the real cases. The
            // filename itself reliably says "logo" either way (Commons' own
            // naming convention), so match on that too.
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
                    {story.primaryTopic ? (
                      <>
                        {" · "}
                        <Link href={`/topics/${story.primaryTopic.slug}`}>{story.primaryTopic.name}</Link>
                      </>
                    ) : null}
                  </div>
                  <h2>{story.articles[0] ? <Link href={`/articles/en/${story.articles[0].slug}`}>{story.title}</Link> : story.title}</h2>
                </div>
              </li>
            );
          })}
          {stories.length === 0 && <p>No stories ingested yet — run the worker's ingestion job.</p>}
        </ul>
      </section>

      {topicSections.map(({ topic, stories: topicStories }) => (
        <section key={topic.id} style={{ marginTop: 32 }}>
          <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)" }}>
            <Link href={`/topics/${topic.slug}`}>{topic.name}</Link>
          </h2>
          <ul className="story-list">
            {topicStories.slice(0, 5).map((story) => {
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
                    <h3 style={{ fontSize: 18, margin: 0 }}>
                      {story.articles[0] ? <Link href={`/articles/en/${story.articles[0].slug}`}>{story.title}</Link> : story.title}
                    </h3>
                  </div>
                </li>
              );
            })}
          </ul>
          {topicStories.length > 5 && (
            <p className="story-meta">
              <Link href={`/topics/${topic.slug}`}>See all {topicStories.length} →</Link>
            </p>
          )}
        </section>
      ))}
    </>
  );
}
