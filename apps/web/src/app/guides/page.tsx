import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getGuides } from "@/lib/api";
import { isLogoImage, LeadMedia } from "@/components/ArticleMedia";
import { ContentCard } from "@/components/ContentCard";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

export async function generateMetadata(): Promise<Metadata> {
  const path = "/guides";
  const alternates = buildHreflangAlternates(SITE_URL, path);
  return {
    title: "Guides",
    description: "Plain-language explainers on EV range and charging, safety ratings, and how to actually compare cars — not news, just the background a reader needs once.",
    alternates: {
      canonical: buildLocaleUrl(SITE_URL, "en", path),
      languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
    },
  };
}

// New section (2026-09-11) — user's own pick, via AskUserQuestion, for
// where GUIDE-type evergreen content should live ("Новый раздел /guides
// (Recommended)"). First real listing page of its kind on this site:
// /topics and /brands only ever got detail pages ([slug]/page.tsx), no
// index — this one needs an index since there's no other natural entry
// point into "every guide" the way a topic or brand slug already exists
// for those sections.
//
// Premium redesign, 2026-09-17 — user's own direct ask ("news и гайды
// тоже современно надо сделать с большой новостью"), same pattern as
// /news, /comparisons and /topics/[slug]: the newest guide as a large
// featured hero card, the rest in the ContentCard grid. Also the first
// time this page renders GuideSummary's own `images` field at all — it
// carried real HERO photos since 2026-09-16 (see GET /v1/guides's own
// comment) but this page never displayed them, every guide rendering as
// a bare text link.
export default async function GuidesIndexPage() {
  const { guides } = await getGuides();
  const [featured, ...rest] = guides;

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: "Guides", url: `${SITE_URL}/guides` },
  ]);

  return (
    <section>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 6 }}>
        Guides
      </div>
      <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(26px, 3.5vw, 36px)", fontWeight: 800, margin: "0 0 10px", lineHeight: 1.15 }}>
        Explainers, not news
      </h1>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: 15.5, color: "var(--ink-dim)", margin: "0 0 32px", maxWidth: "65ch", lineHeight: 1.6 }}>
        Background you only need to read once — what an EV range number actually means, how crash-test ratings work,
        what to weigh when cross-shopping two models. No breaking news here, just the plain-language context.
      </p>

      {featured && (
        <Link href={`/articles/${featured.locale}/${featured.slug}`} className="premium-card" style={{ display: "block", marginBottom: 40 }}>
          <LeadMedia
            images={featured.images}
            isLogo={isLogoImage(featured.images)}
            fallbackAlt={featured.headline}
            width="100%"
            borderRadius={0}
            marginBottom={0}
          />
          <div style={{ padding: "24px 28px 28px" }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 10 }}>
              Latest guide
            </div>
            <h2 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(22px, 2.6vw, 30px)", fontWeight: 800, margin: "0 0 12px", lineHeight: 1.2 }}>
              {featured.headline}
            </h2>
            {featured.subtitle && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: 15, color: "var(--ink-dim)", lineHeight: 1.6, margin: 0 }}>{featured.subtitle}</p>
            )}
          </div>
        </Link>
      )}

      {rest.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 24 }}>
          {rest.map((guide) => (
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
      )}
      {guides.length === 0 && <p>No guides published yet.</p>}
    </section>
  );
}
