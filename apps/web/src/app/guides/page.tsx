import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getGuides } from "@/lib/api";

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
export default async function GuidesIndexPage() {
  const { guides } = await getGuides();

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
      {/* SEO pass (2026-09-11): same H1/H2 swap as topics/brands pages —
          one real H1, the specific descriptive heading, not the generic
          eyebrow label. Same styles, same visual result. */}
      <h2 style={{ fontFamily: "Arial, sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-dim)" }}>
        Guides
      </h2>
      <h1 style={{ fontSize: 28, margin: "4px 0 8px" }}>Explainers, not news</h1>
      <p style={{ color: "var(--ink-dim)", margin: "0 0 24px", maxWidth: "65ch" }}>
        Background you only need to read once — what an EV range number actually means, how crash-test ratings work,
        what to weigh when cross-shopping two models. No breaking news here, just the plain-language context.
      </p>
      <ul className="story-list">
        {guides.map((guide) => (
          <li key={guide.slug} className="story-item">
            <h3 style={{ fontSize: 18, margin: 0 }}>
              <Link href={`/articles/${guide.locale}/${guide.slug}`}>{guide.headline}</Link>
            </h3>
            {guide.subtitle && <p className="story-meta" style={{ marginTop: 4 }}>{guide.subtitle}</p>}
          </li>
        ))}
        {guides.length === 0 && <p>No guides published yet.</p>}
      </ul>
    </section>
  );
}
