import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { formatPowerKw, formatDistanceKm, formatCountryName } from "@automotive/utils";
import { getCarModel, type CarEngine } from "@/lib/api";

const CRASH_TEST_ORG_LABEL: Record<string, string> = { EURO_NCAP: "Euro NCAP", IIHS: "IIHS", NHTSA: "NHTSA" };

// Real gap found live 2026-09-14 (user's own screenshots): this page's
// Facts section was rendering the raw `Fact.attribute` slug verbatim —
// "starting_msrp_ecoboost_2026:", "first_generation_launch:" — the
// internal identifier a script writes to, not something a reader should
// ever see. A small acronym dictionary (rather than a full label per
// attribute, which would need updating every time a new Fact is added)
// covers the abbreviations that actually appear in this codebase's own
// attribute names; anything else just gets underscores turned to spaces
// and sentence-cased.
const FACT_ATTRIBUTE_ACRONYMS: Record<string, string> = {
  msrp: "MSRP",
  iihs: "IIHS",
  gtd: "GTD",
  ev: "EV",
  phev: "PHEV",
  hev: "HEV",
  ecoboost: "EcoBoost",
  zl1: "ZL1",
  gt: "GT",
  ss: "SS",
  rt: "R/T",
  awd: "AWD",
  fwd: "FWD",
  rwd: "RWD",
};

function humanizeFactAttribute(attribute: string): string {
  const label = attribute
    .split("_")
    .map((word) => FACT_ATTRIBUTE_ACRONYMS[word.toLowerCase()] ?? word)
    .join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// A short numeric Fact (e.g. attribute "starting_msrp_ecoboost_2026",
// value "32995", unit "usd") read naturally as a price; anything else —
// including this codebase's own longer, already-prose Fact values like
// "Production of the sixth-generation Camaro ended December 14, 2023..."
// — is shown as written rather than mangled by a formatter built for
// short numbers.
function formatFactValue(value: string, unit: string | null): string {
  const isPlainNumber = /^-?\d+(\.\d+)?$/.test(value);
  if (!isPlainNumber) return value;
  if (unit === "usd") return `$${Number(value).toLocaleString("en-US")}`;
  return unit ? `${Number(value).toLocaleString("en-US")} ${unit}` : Number(value).toLocaleString("en-US");
}
const CATEGORY_SCORE_LABEL: Record<string, string> = {
  adult_occupant: "Adult occupant",
  child_occupant: "Child occupant",
  pedestrian: "Pedestrian",
  safety_assist: "Safety assist",
};

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const SITE_NAME = process.env.PROJECT_NAME ?? "PROJECT_NAME";

// Builds a title/description suffix from whatever this specific car
// page actually has — SEO pass (2026-09-11), real gap: this page had no
// title/description of its own at all, so every car page (BMW X5,
// Mercedes GLE, ...) shared the exact same site-wide default title, a
// real duplicate-title issue across every model page on the site.
// Deliberately built from the real sections this render actually has
// data for (crash tests / generations) rather than a fixed phrase, per
// the brief's own "do not invent specifications" rule — a model with no
// crash-test row yet doesn't claim "Safety" in its own title.
function buildCarPageCopy(carModel: { brand: { name: string }; name: string; generations: unknown[]; crashTests: unknown[] }) {
  const fullName = `${carModel.brand.name} ${carModel.name}`;
  const parts = ["Specs"];
  if (carModel.generations.length > 0) parts.push("Generations");
  if (carModel.crashTests.length > 0) parts.push("Safety Ratings");
  const title = `${fullName}: ${parts.join(", ").replace(/, ([^,]*)$/, " & $1")}`;
  const description = `${fullName} specifications${
    carModel.generations.length > 0 ? ", generation history" : ""
  }${carModel.crashTests.length > 0 ? ", crash-test ratings" : ""} and real photos — sourced and checked on ${SITE_NAME}.`;
  return { title, description };
}

// spec §22/§30: real hreflang + canonical, not just an English-only page
// pretending to be locale-aware. The /es/ edition of this route doesn't
// exist yet (see README.md status table) — the alternate link is still
// correct to emit now, since it documents the intended URL for when it
// does, and Google tolerates a not-yet-live alternate far better than a
// page that never declares one at all.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ brand: string; model: string }>;
}): Promise<Metadata> {
  const { brand, model } = await params;
  const path = `/cars/${brand}/${model}`;
  const alternates = buildHreflangAlternates(SITE_URL, path);
  const canonicalUrl = buildLocaleUrl(SITE_URL, "en", path);
  const base: Metadata = {
    alternates: {
      canonical: canonicalUrl,
      languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
    },
  };

  const result = await getCarModel(brand, model);
  if (!result) return base;
  const { carModel } = result;
  const { title, description } = buildCarPageCopy(carModel);
  const heroImage = carModel.images.find((img) => img.role === "HERO");

  return {
    ...base,
    title,
    description,
    openGraph: {
      type: "website",
      title: `${title} | ${SITE_NAME}`,
      description,
      url: canonicalUrl,
      siteName: SITE_NAME,
      images: heroImage ? [{ url: heroImage.image.originalUrl }] : undefined,
    },
    twitter: {
      card: heroImage ? "summary_large_image" : "summary",
      title: `${title} | ${SITE_NAME}`,
      description,
      images: heroImage ? [heroImage.image.originalUrl] : undefined,
    },
  };
}

// Real gap found and fixed 2026-09-07: `packages/utils`'s real,
// unit-tested locale-aware unit formatting (`formatPowerKw()`,
// `formatDistanceKm()` — spec §93-94, "render one value per market, not
// the raw stored number with a hardcoded unit") had zero callers
// anywhere in `apps/web` or `apps/api`. This page was showing BOTH hp
// and kW simultaneously with hardcoded literal suffixes instead of the
// one real value the spec's own worked example calls for. Both of this
// project's two real seeded markets (US, GB) are `unitSystem: "imperial"`
// — no market-selection UI exists yet to pick a different one, so
// "imperial" here reflects the only two real markets that exist today,
// not an arbitrary guess. Falls back to whichever raw field IS present
// when the canonical one (kW / km) is missing — both are optional in the
// schema — rather than showing nothing for real data that only has the
// non-canonical field recorded.
function formatEnginePower(engine: CarEngine): string | null {
  if (engine.powerKw != null) return formatPowerKw(engine.powerKw, "imperial");
  if (engine.powerHp != null) return `${engine.powerHp} hp`;
  return null;
}

function formatBatteryRange(battery: { rangeKm: number | null; rangeMiles: number | null }): string | null {
  if (battery.rangeKm != null) return formatDistanceKm(battery.rangeKm, "imperial");
  if (battery.rangeMiles != null) return `${Math.round(battery.rangeMiles)} miles`;
  return null;
}

// spec §24 car page. Photos/crash-test ratings landed 2026-09-11 (vertical-
// slice plan) — pricing/competitors/comparisons still come once those data
// sources exist rather than being faked here.
export default async function CarModelPage({
  params,
}: {
  params: Promise<{ brand: string; model: string }>;
}) {
  const { brand, model } = await params;
  const result = await getCarModel(brand, model);
  if (!result) notFound();
  const { carModel, relatedStories } = result;

  // spec §29: real BreadcrumbList — only the pages that actually exist
  // (no fabricated "/cars" or "/cars/{brand}" index page, since neither
  // is a real route today). Article/NewsArticle/ImageObject JSON-LD
  // stay deferred (see apps/web/src/app/layout.tsx) since this page has
  // no real article or real photo to describe yet — a breadcrumb only
  // needs real pages to link to, which this one has.
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: carModel.brand.name, url: `${SITE_URL}/brands/${brand}` },
    { name: `${carModel.brand.name} ${carModel.name}`, url: `${SITE_URL}/cars/${brand}/${model}` },
  ]);

  const heroImage = carModel.images.find((img) => img.role === "HERO");

  return (
    <article>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <div className="story-meta">
        <Link href={`/brands/${brand}`}>{carModel.brand.name}</Link>
        {carModel.brand.country ? ` · ${formatCountryName(carModel.brand.country)}` : ""}
      </div>
      {/* SEO pass (2026-09-11): H1 now names the brand too ("BMW X5", not
          just "X5") — the brand was already shown above as a small link,
          but a bare model name left the page's single most important
          heading generic/ambiguous (several brands could plausibly have
          a model called "X5"-adjacent names) and duplicated across
          brands. No visual/design change: same size, same position. */}
      <h1 style={{ fontSize: 32, margin: "4px 0 20px" }}>
        {carModel.brand.name} {carModel.name}
      </h1>

      {heroImage && (
        <figure style={{ margin: "0 0 32px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment */}
          <img
            src={heroImage.image.originalUrl}
            alt={heroImage.altText ?? `${carModel.brand.name} ${carModel.name}`}
            width={heroImage.image.width ?? undefined}
            height={heroImage.image.height ?? undefined}
            style={{ width: "100%", height: "auto", display: "block", borderRadius: 4 }}
          />
          {heroImage.image.attribution && (
            <figcaption className="story-meta" style={{ marginTop: 4 }}>
              {heroImage.image.attribution}
            </figcaption>
          )}
        </figure>
      )}

      {carModel.images.filter((img) => img.role === "GALLERY").length > 0 && (
        // Added 2026-09-13: the API's own `images` include (no role
        // filter, ordered by position) already returned every GALLERY
        // row — this page just never rendered anything but the single
        // HERO one. Same grid treatment as the article page's own
        // GALLERY section (see apps/web/src/app/articles/[locale]/
        // [slug]/page.tsx), so a car model with several real, sourced
        // photos (front/rear/interior, different generations) actually
        // shows more than one image.
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginBottom: 24 }}>
          {carModel.images
            .filter((img) => img.role === "GALLERY")
            .map((img) => (
              <figure key={img.id} style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment */}
                <img
                  src={img.image.originalUrl}
                  alt={img.altText ?? `${carModel.brand.name} ${carModel.name}`}
                  style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 4, display: "block" }}
                />
                {img.image.attribution && (
                  <figcaption className="story-meta" style={{ marginTop: 2, fontSize: 11 }}>
                    {img.image.attribution}
                  </figcaption>
                )}
              </figure>
            ))}
        </div>
      )}

      {carModel.facts.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16 }}>Facts</h2>
          <ul className="story-list">
            {carModel.facts.map((fact) => (
              <li key={fact.id} className="story-item">
                <span className="badge">{fact.status}</span>
                <strong>{humanizeFactAttribute(fact.attribute)}</strong>: {formatFactValue(fact.value, fact.unit)}
                {fact.market ? ` (${fact.market.code} market)` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {carModel.generations.map((gen) => (
        <section key={gen.id} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16 }}>
            {gen.name} ({gen.startYear ?? "?"}–{gen.endYear ?? "present"})
          </h2>
          <ul className="story-list">
            {gen.trims.map((trim) => (
              <li key={trim.id} className="story-item">
                <h3 style={{ fontSize: 18, margin: "0 0 6px" }}>{trim.name}</h3>
                {trim.engines.map((engine) => (
                  <div key={engine.id} className="story-meta">
                    {engine.name}
                    {formatEnginePower(engine) ? ` — ${formatEnginePower(engine)}` : ""}
                  </div>
                ))}
                {trim.batteries.map((battery) => (
                  <div key={battery.id} className="story-meta">
                    {battery.capacityKwh != null ? `${battery.capacityKwh} kWh battery` : "Battery"}
                    {formatBatteryRange(battery) ? ` — ${formatBatteryRange(battery)} range` : ""}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {carModel.crashTests.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16 }}>Crash test ratings</h2>
          <ul className="story-list">
            {carModel.crashTests.map((test) => (
              <li key={test.id} className="story-item">
                <strong>
                  {CRASH_TEST_ORG_LABEL[test.organization] ?? test.organization} {test.testYear}: {test.overallRating}
                </strong>
                {test.categoryScores && (
                  <div className="story-meta">
                    {Object.entries(test.categoryScores)
                      .map(([key, value]) => `${CATEGORY_SCORE_LABEL[key] ?? key}: ${value}`)
                      .join(" · ")}
                  </div>
                )}
                <div className="story-meta">
                  <a href={test.sourceUrl} target="_blank" rel="noreferrer">
                    Source
                  </a>
                </div>
                {test.video && (
                  // Real footage of this exact test, shown right next to
                  // its own rating rather than only in the general video
                  // list further down — CrashTestResult.videoId existed
                  // in the schema since it first landed, this is the
                  // first real row to actually use it.
                  <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, maxWidth: 480, marginTop: 8 }}>
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${test.video.youtubeId}`}
                      title={test.video.title}
                      loading="lazy"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: 0 }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(["OFFICIAL", "CRASH_TEST", "REVIEW"] as const).map((category) => {
        // Skip any video already embedded inline next to its own
        // CrashTestResult rating above — same video, shown once, not
        // twice on the same page.
        const inlineVideoIds = new Set(carModel.crashTests.map((t) => t.video?.id).filter(Boolean));
        const categoryVideos = carModel.videos.filter((v) => v.category === category && !inlineVideoIds.has(v.id));
        if (categoryVideos.length === 0) return null;
        const heading = category === "OFFICIAL" ? "Official videos" : category === "CRASH_TEST" ? "Crash test videos" : "Reviews";
        return (
          <section key={category} style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 16 }}>{heading}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {categoryVideos.map((video) => (
                <div key={video.id}>
                  <div className="story-meta">{video.title}</div>
                  {/* 16:9 responsive embed via the classic padding-bottom trick — this
                      app has no CSS framework/utility classes, only inline styles, so
                      the wrapper's height comes from that padding rather than aspect-ratio
                      (broad browser support without depending on a newer CSS feature). */}
                  <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, maxWidth: 640 }}>
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}`}
                      title={video.title}
                      loading="lazy"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: 0 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {carModel.featuredArticles.length > 0 && (
        // Real gap found and fixed 2026-09-11: ArticleCarModel has real
        // rows for every COMPARISON/ANALYSIS/GUIDE piece that explicitly
        // names this model, but nothing on this page ever surfaced them
        // — confirmed live that this page had zero link to the real
        // comparison/analysis articles written specifically about it,
        // even though the reverse direction (an article's own "Related
        // cars" section) has linked back here since 2026-09-11 earlier
        // the same day. Shown ahead of "Related stories" since these
        // are substantial, evergreen pieces rather than transient news.
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16 }}>Featured articles</h2>
          <ul className="story-list">
            {carModel.featuredArticles.map((article) => (
              <li key={article.slug} className="story-item">
                <span className="story-meta">{article.type}</span>
                <br />
                <Link href={`/articles/${article.locale}/${article.slug}`}>{article.headline}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {relatedStories.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16 }}>Related stories</h2>
          <ul className="story-list">
            {relatedStories.map((story) => (
              <li key={story.id} className="story-item">
                {story.articleSlug ? <Link href={`/articles/en/${story.articleSlug}`}>{story.title}</Link> : story.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
