import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, buildCarJsonLd, safeJsonLdString } from "@automotive/seo";
import { formatPowerKw, formatDistanceKm, formatCountryName } from "@automotive/utils";
import { getCarModel, type CarEngine, type CarTrim } from "@/lib/api";
import { clampedAspectRatio } from "@/lib/image-aspect";

const CRASH_TEST_ORG_LABEL: Record<string, string> = { EURO_NCAP: "Euro NCAP", IIHS: "IIHS", NHTSA: "NHTSA" };

// Real gap found live 2026-09-14 (user's own screenshots): this page's
// Facts section was rendering the raw `Fact.attribute` slug verbatim —
// "starting_msrp_ecoboost_2026:", "first_generation_launch:" — the
// internal identifier a script writes to, not something a reader should
// ever see. A small acronym dictionary (rather than a full label per
// attribute, which would need updating every time a new Fact is added)
// covers the abbreviations that actually appear in this codebase's own
// attribute names; anything else just gets underscores turned to spaces
// and sentence-cased. Second real gap found the same pass, live on
// Corolla/Civic/CR-V/Model 3/Camaro's own crash-test sections: IIHS's
// own categoryScores keys (`small_overlap_front`, `moderate_overlap_front`,
// `front_crash_prevention_pedestrian`, ...) hit the exact same bug one
// section further down the page, via a separate 4-entry
// CATEGORY_SCORE_LABEL map that only ever covered Euro NCAP's own 4
// category names — every IIHS category fell through to the raw key.
// One shared humanizer now covers both call sites instead of two
// separate, inconsistently-maintained label maps.
const SLUG_ACRONYMS: Record<string, string> = {
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

function humanizeSlug(slug: string): string {
  const label = slug
    .split("_")
    .map((word) => SLUG_ACRONYMS[word.toLowerCase()] ?? word)
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
  const result = await getCarModel(brand, model);

  // Blanket-paused 2026-09-14 (catalog rough/uneven everywhere). Briefly
  // gated on generations.length>=2 (2026-09-15), replaced same-day by
  // the real `catalogReviewedAt` gate once an unattended sweep proved a
  // generation count isn't a quality signal (see CarModel's own schema
  // comment, and GET /v1/cars's). `follow: true` always, so crawling
  // still flows through to whatever a not-yet-reviewed page links to.
  const robots = { index: result?.carModel.catalogReviewedAt != null, follow: true };

  const base: Metadata = {
    alternates: {
      canonical: canonicalUrl,
      languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
    },
    robots,
  };

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
      // Real dimensions added 2026-09-14 (SEO pass) — this project
      // already captures every self-hosted photo's real width/height
      // (see self-host-image.ts) but never passed it through here,
      // leaving every social unfurl to guess the aspect ratio instead
      // of being told it up front.
      images: heroImage
        ? [{ url: heroImage.image.originalUrl, width: heroImage.image.width ?? undefined, height: heroImage.image.height ?? undefined }]
        : undefined,
    },
    twitter: {
      card: heroImage ? "summary_large_image" : "summary",
      title: `${title} | ${SITE_NAME}`,
      description,
      images: heroImage
        ? [{ url: heroImage.image.originalUrl, width: heroImage.image.width ?? undefined, height: heroImage.image.height ?? undefined }]
        : undefined,
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

// Real number, not a raw fuel-string dump: "petrol"/"phev" read as
// programmer enum values, not copy — same "never show a raw internal
// value to a reader" rule the Facts/crash-test-category fix already
// applied here, extended to the new spec table's own Fuel column.
const FUEL_LABEL: Record<string, string> = {
  petrol: "Gasoline",
  gasoline: "Gasoline",
  diesel: "Diesel",
  hybrid: "Hybrid",
  phev: "Plug-in Hybrid",
  electric: "Electric",
};
function formatFuel(engine: CarEngine): string {
  return engine.fuel ? (FUEL_LABEL[engine.fuel.toLowerCase()] ?? engine.fuel) : "—";
}

// Sort key for showing trims lowest-to-highest power (the order every
// real manufacturer brochure uses — base, mid, performance) instead of
// raw database insertion order, which reads as arbitrary once a
// generation has a dozen-plus trims added across several separate
// backfill passes. A trim with no recorded power sorts first (treated
// as 0) rather than landing in an unpredictable spot.
function trimPowerHp(trim: CarTrim): number {
  return Math.max(0, ...trim.engines.map((e) => e.powerHp ?? (e.powerKw != null ? e.powerKw * 1.34102 : 0)));
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

  // Real structured-data gap closed 2026-09-14 (SEO pass): this page
  // had a BreadcrumbList and nothing describing the actual subject —
  // see packages/seo/src/car.ts's own header for why `Car` and only
  // real, sourced fields. Current generation = the one still in
  // production (no endYear) if one exists, else whichever started most
  // recently — never invented, both real fields already on `carModel`.
  const currentGeneration = [...carModel.generations].sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0))[0];
  const currentGenerationInProduction = carModel.generations.find((gen) => gen.endYear == null) ?? currentGeneration;
  const fuelTypes = Array.from(
    new Set(
      carModel.generations
        .flatMap((gen) => gen.trims)
        .flatMap((trim) => trim.engines)
        .map((engine) => (engine.fuel ? (FUEL_LABEL[engine.fuel.toLowerCase()] ?? engine.fuel) : null))
        .filter((f): f is string => f != null),
    ),
  );
  const { description: carDescription } = buildCarPageCopy(carModel);
  // JSON-LD I write by hand here isn't run through Next's own Metadata
  // object, so its `metadataBase`-driven relative-URL resolution (the
  // reason og:image already renders as a full https:// URL) doesn't
  // apply — a bare "/uploads/..." path needs resolving to absolute here
  // explicitly, or structured-data validators reject it.
  const absoluteHeroImageUrl = heroImage?.image.originalUrl
    ? heroImage.image.originalUrl.startsWith("http")
      ? heroImage.image.originalUrl
      : `${SITE_URL}${heroImage.image.originalUrl}`
    : undefined;
  const carJsonLd = buildCarJsonLd({
    brandName: carModel.brand.name,
    modelName: carModel.name,
    description: carDescription,
    url: `${SITE_URL}/cars/${brand}/${model}`,
    imageUrl: absoluteHeroImageUrl,
    fuelTypes,
    currentModelName: currentGenerationInProduction?.name,
    modelDate: currentGenerationInProduction?.startYear ? String(currentGenerationInProduction.startYear) : undefined,
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
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(carJsonLd) }}
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

      {carModel.images.filter((img) => img.role === "GALLERY" && !img.generationId).length > 0 && (
        // Model-level gallery photos only (no specific generation named)
        // — anything tied to one Generation renders inside that
        // generation's own section below instead, per the real gap the
        // user found live 2026-09-14: a flat, undifferentiated gallery
        // of several generations' worth of photos gave a reader no way
        // to tell which car in the gallery was which generation.
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginBottom: 24 }}>
          {carModel.images
            .filter((img) => img.role === "GALLERY" && !img.generationId)
            .map((img) => (
              <figure key={img.id} style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment */}
                <img
                  src={img.image.originalUrl}
                  alt={img.altText ?? `${carModel.brand.name} ${carModel.name}`}
                  // No-crop fix (2026-09-15, user's own direct
                  // complaint with a screenshot): "cover" cut real
                  // parts off a real car photo to fill this tile.
                  // Ratio itself fixed 2026-09-16 (user's own follow-up
                  // complaint that flat "4 / 3" letterboxed every real
                  // photo, which never matches that ratio) — each tile
                  // now uses its own photo's real shape.
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
                <strong>{humanizeSlug(fact.attribute)}</strong>: {formatFactValue(fact.value, fact.unit)}
                {fact.market ? ` (${fact.market.code} market)` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {carModel.generations.length > 0 && (
        <section style={{ marginBottom: 8 }}>
          <h2 style={{ fontSize: 16 }}>Generations &amp; specifications</h2>
          {carModel.generations.length > 2 && (
            // Jump-to nav, added 2026-09-14 (user's own ask for more
            // "where is what" orientation) — genuinely useful once a
            // nameplate has several generations (BMW X5: 5) rather than
            // making a reader scroll past ones they don't care about,
            // and the per-generation anchor ids double as real in-page
            // targets search engines can link straight to.
            <nav aria-label="Jump to a generation" style={{ marginBottom: 16 }}>
              {carModel.generations.map((gen, i) => (
                <span key={gen.id}>
                  {i > 0 && " · "}
                  <a href={`#gen-${gen.id}`}>
                    {gen.name}
                    {gen.startYear ? ` (${gen.startYear}–${gen.endYear ?? "present"})` : ""}
                  </a>
                </span>
              ))}
            </nav>
          )}
        </section>
      )}

      {carModel.generations.map((gen) => (
        <section key={gen.id} id={`gen-${gen.id}`} style={{ marginBottom: 32, scrollMarginTop: 16 }}>
          <h3 style={{ fontSize: 18 }}>
            {gen.name}
            {/* Real gap found live 2026-09-15 (Acura RDX's own Fourth
                generation, no infobox/header year on its own Wikipedia
                section — a genuinely brand-new section that hasn't been
                filled in yet): a bare "?" for a missing start year is
                exactly the "unexplained figure" this project's own
                quality bar forbids — omit the whole year range instead
                of guessing or showing a placeholder, same pattern the
                trim-table caption below already used. */}
            {gen.startYear ? ` (${gen.startYear}–${gen.endYear ?? "present"})` : ""}
          </h3>
          {carModel.images
            .filter((img) => img.generationId === gen.id)
            .map((img) => (
              <figure key={img.id} style={{ margin: "0 0 12px", maxWidth: 480 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment */}
                <img
                  src={img.image.originalUrl}
                  alt={img.altText ?? `${carModel.brand.name} ${carModel.name} — ${gen.name}`}
                  // No-crop fix (2026-09-15) — see the gallery figure
                  // above for why. Ratio itself fixed 2026-09-16, same
                  // reason as that figure's own updated comment.
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
                  <figcaption className="story-meta" style={{ marginTop: 2, fontSize: 11 }}>
                    {img.image.attribution}
                  </figcaption>
                )}
              </figure>
            ))}
          {gen.trims.length > 0 &&
            (() => {
              // Real redesign 2026-09-14, user's own explicit ask: a
              // real spec table (the shape every other automotive
              // catalog uses) reads far better than a bare bulleted
              // list once a generation has a dozen-plus trims (see BMW
              // X5's own G05 section) — same table styling as the
              // article page's own SPEC_TABLE block, for one consistent
              // look across the site. The Battery/Range column only
              // appears for generations that actually have an
              // electrified trim, so a plain gas-only generation's
              // table doesn't carry two empty columns. Sorted lowest-
              // to-highest power (real brochure order) instead of raw
              // insertion order, which reads as arbitrary once trims
              // were added across several separate backfill passes.
              // Zebra-striped and unit-labeled headers per the user's
              // own "make it clearer what's where" follow-up.
              const hasBattery = gen.trims.some((trim) => trim.batteries.length > 0);
              // Added 2026-09-15, same reasoning as `hasBattery`: EPA
              // (this pipeline's trim source for most generations) never
              // carries horsepower/torque at all — every cell in this
              // column was rendering as a bare "—" for those, a hollow
              // column that added nothing. Hidden entirely when not one
              // trim in this generation has real power data.
              const hasPower = gen.trims.some((trim) => trim.engines.some((e) => formatEnginePower(e) != null));
              const sortedTrims = [...gen.trims].sort((a, b) => trimPowerHp(a) - trimPowerHp(b));
              const th: CSSProperties = { textAlign: "left", padding: "6px 12px", borderBottom: "2px solid var(--line)" };
              return (
                <div style={{ overflowX: "auto", marginBottom: 4 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <caption style={{ captionSide: "bottom", textAlign: "left", marginTop: 6, fontSize: 11 }} className="story-meta">
                      {sortedTrims.length} trim{sortedTrims.length === 1 ? "" : "s"} for the {gen.name} generation
                      {gen.startYear ? ` (${gen.startYear}–${gen.endYear ?? "present"})` : ""}, sorted by power.
                    </caption>
                    <thead>
                      <tr>
                        <th style={{ ...th, paddingLeft: 0 }}>Trim</th>
                        <th style={th}>Engine</th>
                        <th style={th}>Fuel</th>
                        {hasPower && <th style={th}>Power (hp)</th>}
                        {hasBattery && <th style={th}>Battery / EV range</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedTrims.map((trim, i) => {
                        const battery = trim.batteries[0];
                        const td: CSSProperties = {
                          padding: "6px 12px",
                          borderBottom: "1px solid var(--line)",
                          background: i % 2 === 1 ? "var(--surface-alt, rgba(128,128,128,0.06))" : undefined,
                        };
                        return (
                          <tr key={trim.id}>
                            <td style={{ ...td, paddingLeft: 0, fontWeight: 600 }}>{trim.name}</td>
                            <td style={td}>{trim.engines.map((e) => e.name).join("; ") || "—"}</td>
                            <td style={td}>{trim.engines.map((e) => formatFuel(e)).join("; ") || "—"}</td>
                            {hasPower && (
                              <td style={td}>{trim.engines.map((e) => formatEnginePower(e)).filter(Boolean).join("; ") || "—"}</td>
                            )}
                            {hasBattery && (
                              <td style={td}>
                                {battery
                                  ? [
                                      battery.capacityKwh != null ? `${battery.capacityKwh} kWh` : null,
                                      formatBatteryRange(battery) ? `${formatBatteryRange(battery)} range` : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" — ") || "—"
                                  : "—"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
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
                      .map(([key, value]) => `${humanizeSlug(key)}: ${value}`)
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
