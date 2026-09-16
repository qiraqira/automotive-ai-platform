import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl } from "@automotive/seo";
import { getGuides, getBrands, getFeaturedArticles, getFeaturedCars, getStories, type FeaturedCar } from "@/lib/api";
import { rankStories } from "@/lib/ranking";
import { isLogoImage, LeadMedia } from "@/components/ArticleMedia";
import { ContentCard } from "@/components/ContentCard";
import CinematicVideo from "@/components/CinematicVideo";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const SITE_NAME = process.env.PROJECT_NAME ?? "PROJECT_NAME";

// Cap added 2026-09-14 — see the section below's own longer comment.
const HOMEPAGE_ARTICLE_LIMIT = 6;

// SEO pass (2026-09-11): the homepage never set its own title/
// description before, silently inheriting layout.tsx's generic
// site-wide default on every page that didn't override it — a real,
// meaningful gap once the homepage itself became a page with real,
// specific content worth describing on its own rather than falling back
// to the site-wide tagline. See SEO.md's homepage rule.
//
// Rewritten 2026-09-14, user's own explicit ask to build a real keyword
// core and check it against what the homepage actually leads with now.
// The old title ("Car Specs, Models, Comparisons & Auto News") was
// written when the catalog ("Explore models" -> specs/generations) was
// still the homepage's second section — it's since been paused and
// hidden (see this same date's "Explore models" gate below), so leading
// the title with "Specs, Models" no longer matches what a visitor
// actually lands on. What the site's real published content overwhelm-
// ingly is now: COMPARISON/ANALYSIS pieces (a "Tesla Model 3 vs Toyota
// Corolla" piece is, in substance, a car review — the word "review"
// itself never appeared anywhere in the old title/description despite
// that being real, high-intent search volume in this vertical) and real
// NEWS. "Auto news" (not just "automotive news") kept from the
// 2026-09-12 fix for the same reason as before: it's how people actually
// phrase the search.
const HOME_TITLE = "Car Comparisons, Reviews & Auto News";
const HOME_DESCRIPTION =
  "In-depth car comparisons and reviews with real specs and safety ratings, plus the latest auto news — every figure sourced and checked.";

export const metadata: Metadata = {
  // Verified live: unlike every nested route (car/brand/guides/topics
  // pages), the root "/" page does not inherit layout.tsx's title
  // template — Next.js resolves the root layout+page pair as a single
  // segment rather than templating across it. Suffixing manually here is
  // the one deliberate exception to SEO.md's "bare string, no suffix"
  // rule, and only because the template genuinely doesn't reach this
  // route.
  title: `${HOME_TITLE} | ${SITE_NAME}`,
  description: HOME_DESCRIPTION,
  alternates: {
    canonical: buildLocaleUrl(SITE_URL, "en", ""),
    languages: Object.fromEntries(buildHreflangAlternates(SITE_URL, "").map((a) => [a.hreflang, a.href])),
  },
  openGraph: {
    type: "website",
    title: `${HOME_TITLE} | ${SITE_NAME}`,
    description: HOME_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
  },
  twitter: {
    card: "summary",
    title: `${HOME_TITLE} | ${SITE_NAME}`,
    description: HOME_DESCRIPTION,
  },
};

// Premium redesign, 2026-09-16 — user's own two approved mockups
// (autonewsfeed-variant-a/b: dark header + hero, light content, red
// accent, soft-shadow rounded cards). Kept every real data source and
// URL from the portal rewrite this replaces (2026-09-11, "не как
// новостная лента была, а ... портал") — only the visual language
// changes. The mockups' own comparison-card/hero photos were AI-
// generated (Pollinations.ai) or of unverified real provenance — see
// this session's own live test (three generic silhouettes for a
// "Civic and Mazda3" prompt, not either real car) and the resulting
// memory file (real-photos-never-ai-generated.md). Every photo below is
// still a real, already self-hosted, already rights-checked photo from
// this project's own catalog/article data — ContentCard (via LeadMedia)
// is the same component built for the no-crop/aspect-ratio fixes
// earlier this session, not a new image pipeline.
function findHeroCarPhoto(cars: FeaturedCar[], brandSlug: string, modelSlug: string) {
  return cars.find((c) => c.brandSlug === brandSlug && c.modelSlug === modelSlug) ?? null;
}

export default async function HomePage() {
  const [{ carModels: featuredCars }, { articles: featuredArticles }, { guides }, { brands: allBrands }, { stories: unrankedStories }] =
    await Promise.all([
      getFeaturedCars(),
      getFeaturedArticles(),
      getGuides(),
      getBrands(),
      getStories({ limit: 20, hasArticle: true }),
    ]);
  // Same "real content only" filter as /brands's own index page (added
  // 2026-09-15) — this is exactly the "links at the bottom" the catalog
  // was told to keep when its main showcase section got paused, and a
  // link to a brand page with nothing on it is no better a landing spot
  // than the showcase grid was.
  const brands = allBrands.filter((b) => b.contentCount > 0 || b.reviewedModelCount > 0);
  const news = rankStories(unrankedStories).slice(0, 7);

  // Hero photo pair swapped 2026-09-17, user's own direct call after
  // seeing the same-day no-crop (object-fit:contain) version live: two
  // letterboxed photos read as "бестолковые" (awkward/pointless) rather
  // than clean. Reverted to a filled, cropped square — but BMW X5 and
  // Audi Q7 specifically, both hand-reviewed catalog entries (see GET
  // /v1/featured-cars's own comment: X5 was the user's own example of a
  // catalog model done right), not the Civic/Mazda3 pair. Each photo now
  // also links to its own brand catalog page, per that same request.
  //
  // Swapped again same day to 7 Series / Q5, user's own direct follow-up
  // ("некрасиво обрезано. подбирай картинки так чтобы красиво
  // обрезались"): X5 (1200x641, 1.87 wide) and Q7 (1200x621, 1.93 wide)
  // are both long 3/4-driving/profile shots — cropping either into a
  // square (object-fit:cover) trims so much off the sides that the crop
  // lands mid-car rather than showing a clean, recognizable front end.
  // Checked every reviewed BMW/Audi hero photo's real aspect ratio for
  // the closest-to-square pair instead of guessing: 7 Series (1200x900,
  // 1.33 — the closest of any BMW) and Q5 (1200x798, 1.50, tied for
  // closest Audi with Q3) are both already tight, centered 3/4-front
  // shots with the grille/badge close to frame-center, so a square crop
  // barely trims the sides instead of cutting through the middle of
  // the car.
  const heroCarA = findHeroCarPhoto(featuredCars, "bmw", "7-series");
  const heroCarB = findHeroCarPhoto(featuredCars, "audi", "q5");

  return (
    <>
      {/* Dark hero — breaks out of <main>'s own "wrap" (max-width:1200px)
          via the classic negative-margin/100vw trick so it can go full-
          bleed edge to edge like the header/footer, then re-applies the
          same 1200px column inside itself so the actual content still
          lines up with every section below it. */}
      <section
        style={{
          marginLeft: "calc(50% - 50vw)",
          marginRight: "calc(50% - 50vw)",
          width: "100vw",
          background: "linear-gradient(160deg, var(--bg-dark) 0%, #14181f 100%)",
          marginBottom: 40,
        }}
      >
        <div
          className="wrap"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 48,
            flexWrap: "wrap",
            padding: "56px 20px",
          }}
        >
          <div style={{ flex: "1 1 420px", minWidth: 280 }}>
            {/* H1 rewritten 2026-09-14 alongside HOME_TITLE/HOME_DESCRIPTION
                above — same reasoning: carries the real target keywords
                ("car comparisons", "auto news") instead of a pure tagline. */}
            <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(32px, 4.5vw, 52px)", fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.01em", margin: "0 0 16px", color: "#fff" }}>
              Car comparisons and auto news, backed by real numbers
            </h1>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: 17, lineHeight: 1.6, color: "#b8c0cc", maxWidth: 480, margin: "0 0 28px" }}>
              In-depth comparisons and reviews — every spec, safety rating and price checked, every photo the real
              car — plus real auto news, covered the same way, as it happens.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link
                href="/comparisons"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 600,
                  fontSize: 15,
                  padding: "13px 24px",
                  borderRadius: 8,
                  background: "var(--accent)",
                  color: "#fff",
                  textDecoration: "none",
                }}
              >
                Explore Comparisons
              </Link>
              <Link
                href="/news"
                style={{
                  fontFamily: "var(--font-sans)",
                  fontWeight: 600,
                  fontSize: 15,
                  padding: "13px 24px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.25)",
                  color: "#fff",
                  textDecoration: "none",
                }}
              >
                Latest News
              </Link>
            </div>
          </div>
          {heroCarA && heroCarB && (
            // Reverted to a filled, cropped square 2026-09-17 (see the
            // heroCarA/heroCarB comment above for why) — full square tiles
            // read cleaner here than the letterboxed real-ratio version
            // that replaced the original 3:4 crop earlier the same day.
            // Each tile is now its own link to that car's brand catalog,
            // per the same request ("при клике на них куда-то шла ссылка
            // ... на каталог Ауди или каталог БМВ").
            <div style={{ flex: "1 1 360px", minWidth: 280, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[heroCarA, heroCarB].map((car) => (
                // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
                <Link key={car.modelSlug} href={`/brands/${car.brandSlug}`} style={{ display: "block", aspectRatio: "1 / 1" }}>
                <img
                  src={car.imageUrl}
                  alt={`${car.brandName} ${car.modelName}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: "center",
                    borderRadius: 16,
                    display: "block",
                    boxShadow: "var(--shadow-lg)",
                  }}
                />
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {featuredArticles.length > 0 && (
        // Real gap found and fixed 2026-09-11: the site's hand-authored
        // COMPARISON/ANALYSIS pieces had no listing endpoint or homepage
        // section at all (see GET /v1/featured-articles's own comment) —
        // exactly the kind of evergreen content a portal's front page
        // should lead with, unlike the news feed this replaces.
        <section style={{ marginBottom: 48 }}>
          <SectionHeader title="Comparisons & Analysis" subtitle="Head-to-head. Data-backed. No guesswork." href="/comparisons" linkText="See all" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
            {featuredArticles.slice(0, HOMEPAGE_ARTICLE_LIMIT).map((article) => (
              <ContentCard
                key={article.slug}
                href={`/articles/${article.locale}/${article.slug}`}
                images={article.images}
                isLogo={isLogoImage(article.images)}
                fallbackAlt={article.headline}
                badge={article.type}
                title={article.headline}
                description={article.subtitle}
                linkText="View Comparison"
              />
            ))}
          </div>
          <SectionFooterLink href="/comparisons" label="Read more comparisons" />
        </section>
      )}

      {
        // Paused 2026-09-14, briefly resumed 2026-09-15 (GET
        // /v1/featured-cars gated to >=2 real generations), re-paused
        // the same day — user's own direct verdict after the >=2-
        // generations gate went live: "каталоги просмотри. x5 сделан
        // супер, а остальное некачественно" (X5 — hand-built one model
        // at a time, real editorial review — is great; everything else,
        // from the unattended bulk auto-seed + generation-discovery
        // sweep, is not good enough). >=2 generations caught gross
        // placeholder stubs but not real quality problems (duplicate/
        // overlapping generations, unreviewed photos, raw EPA option
        // text as a trim name), so this stayed off until every model got
        // the same hand review the X5/GLE/F-150/Mustang/RAV4/Model Y did.
        //
        // Re-enabled 2026-09-16 (the >=2-generations gap above is fully
        // closed — every model now carries a real, hand-verified
        // `catalogReviewedAt`), then paused again the same day on the
        // user's own direct follow-up ask ("Explore models раздел пока
        // убираем с главной" — take it off the homepage for now). Not a
        // quality-gate issue this time, just not wanted here right now;
        // data/flag both stay correct for whenever it comes back.
        false && featuredCars.length > 0 && null
      }

      {/* Added 2026-09-16, user's own ask after reading homepage-
          engagement research together (Reuters Institute Digital News
          Report: audiences want a format/tool that serves their own
          task, not just another curated feed) — the homepage's real
          interactive entry point into the catalog: a live compare tool
          over 222 real, reviewed cars, not a link into a static grid. */}
      <section
        style={{
          textAlign: "center",
          marginBottom: 48,
          padding: "44px 24px",
          borderRadius: 16,
          background: "var(--surface-2)",
        }}
      >
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 10 }}>
          Which one should you buy?
        </div>
        <h2 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 700, margin: "0 auto 20px", maxWidth: 560, lineHeight: 1.3 }}>
          Confused by choices? We compare what matters so you can buy with confidence.
        </h2>
        <Link
          href="/compare"
          style={{
            display: "inline-block",
            fontFamily: "var(--font-sans)",
            fontWeight: 600,
            fontSize: 15,
            padding: "13px 28px",
            borderRadius: 8,
            background: "var(--accent)",
            color: "#fff",
            textDecoration: "none",
          }}
        >
          Compare any two cars →
        </Link>
      </section>

      {/* Added 2026-09-16, user's own ask ("жду как сделать сайт главную
          страницу намного вкуснее и интереснее"): a real video "moment"
          instead of pure text/photo lists all the way down — same
          CinematicVideo component (real curated CarVideo, muted/looping,
          loads only once scrolled to, real unmute) already built for the
          car-model page, its first use anywhere else. One real video,
          not several — a "moment," the same way the reference page the
          user linked (mk.qira.ru/3) uses exactly one. */}
      <section style={{ marginBottom: 48 }}>
        <SectionHeader title="Watch" />
        <CinematicVideo youtubeId="vCniiK7BSNQ" title="2026 Toyota RAV4 Reveal: Ready for Every Road!" label="Official video" />
        <p className="story-meta" style={{ margin: 0 }}>
          <Link href="/cars/toyota/rav4">See the Toyota RAV4&apos;s real specs and trims →</Link>
        </p>
      </section>

      {news.length > 0 && (
        // Restored 2026-09-11 (same day as the portal rewrite, per the
        // user's own follow-up): real news the pipeline actually wrote
        // still needs a home on the homepage — just as one section here,
        // not the page-topping feed it used to be.
        <section style={{ marginBottom: 48 }}>
          <SectionHeader title="Latest News" subtitle="The latest auto news and industry updates" href="/news" linkText="See all" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
            {news.map((story) => {
              const images = story.articles[0]?.images ?? [];
              return (
                <ContentCard
                  key={story.id}
                  href={story.articles[0] ? `/articles/en/${story.articles[0].slug}` : "/news"}
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
          <SectionFooterLink href="/news" label="Read more news" />
        </section>
      )}

      {guides.length > 0 && (
        <section style={{ marginBottom: 48 }}>
          <SectionHeader title="Guides" subtitle="Practical guides to help you drive smarter" href="/guides" linkText="See all" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
            {guides.slice(0, 6).map((guide) => (
              <ContentCard
                key={guide.slug}
                href={`/articles/${guide.locale}/${guide.slug}`}
                images={guide.images}
                isLogo={isLogoImage(guide.images)}
                fallbackAlt={guide.headline}
                badge="Guide"
                title={guide.headline}
                description={guide.subtitle}
                linkText="Read Guide"
              />
            ))}
          </div>
        </section>
      )}

      {brands.length > 0 && (
        <section>
          {/* Real brand logos aren't sourced/licensed anywhere in this
              project — same "real, checked" bar as every car photo (see
              real-photos-never-ai-generated.md) applies to trademarked
              brand marks too, not just to sourcing them via AI. A clean
              text wordmark row is the honest version of the mockups' own
              logo strip until real, rights-checked brand marks exist. */}
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)", textAlign: "center", marginBottom: 20 }}>
            Trusted insights across every brand
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px 32px" }}>
            {brands.map((brand) => (
              <Link
                key={brand.slug}
                href={`/brands/${brand.slug}`}
                style={{ fontFamily: "var(--font-sans)", fontSize: 17, fontWeight: 700, color: "var(--ink-dim)", textDecoration: "none" }}
              >
                {brand.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// Shared section eyebrow/heading, 2026-09-16 redesign — every section
// below the hero used its own hand-rolled `<h2>` with an identical
// uppercase-eyebrow style; this is that same style once, plus the
// mockups' own "See all →" link pattern in the same row.
//
// Made clickable 2026-09-17, user's own direct ask ("в самом заголовке
// ... возможность кликннуть на Comparisons & Analysis") — the eyebrow
// and subtitle used to be plain text, with the only way into the full
// section being the small "See all →" link on the right; both now link
// to `href` too when it's given, same target as that link.
function SectionHeader({ title, subtitle, href, linkText }: { title: string; subtitle?: string; href?: string; linkText?: string }) {
  const eyebrow = (
    <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 6 }}>
      {title}
    </div>
  );
  const heading = subtitle && (
    <h2 style={{ fontFamily: "var(--font-sans)", fontSize: 24, fontWeight: 700, margin: 0 }}>{subtitle}</h2>
  );
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
      <div>
        {href ? (
          <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
            {eyebrow}
            {heading}
          </Link>
        ) : (
          <>
            {eyebrow}
            {heading}
          </>
        )}
      </div>
      {href && linkText && (
        <Link href={href} style={{ fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 600, color: "var(--ink-dim)", textDecoration: "none", whiteSpace: "nowrap" }}>
          {linkText} →
        </Link>
      )}
    </div>
  );
}

// Bottom-of-section "read more" link, 2026-09-17 — user's own direct ask
// (after the Comparisons & Analysis and News grids specifically: "после
// раздела и всех новостей ссылочку на еще типа читать больше"): the only
// way into the full list used to be the small top-right "See all" link
// in SectionHeader, easy to miss once a reader has scrolled past it down
// through the card grid. Same target, just repeated at the natural point
// a reader who's looked through every card here would want it.
function SectionFooterLink({ href, label }: { href: string; label: string }) {
  return (
    <div style={{ textAlign: "center", marginTop: 28 }}>
      <Link
        href={href}
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 14.5,
          fontWeight: 600,
          color: "var(--accent)",
          textDecoration: "none",
        }}
      >
        {label} →
      </Link>
    </div>
  );
}
