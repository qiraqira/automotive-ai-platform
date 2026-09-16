import type { Metadata } from "next";
import { safeJsonLdString } from "@automotive/seo";
import HeaderNav from "@/components/HeaderNav";
import "./globals.css";

// PROJECT_NAME/DOMAIN.COM are placeholders (see .env.example) — swapping
// the real brand name later is a metadata-only change, not an
// architecture change.
const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const SITE_NAME = process.env.PROJECT_NAME ?? "PROJECT_NAME";

// Rewritten 2026-09-14 alongside the homepage's own HOME_DESCRIPTION —
// "knowledge graph" is internal engineering language, not a phrase any
// real reader searches for, and the old copy never said "comparisons",
// "reviews" or "auto news" at all despite those being this site's real
// content and real target search phrases. This is the fallback used by
// every page that doesn't set its own (car pages, topic pages, /about/*,
// search) — see this const's own longer comment below.
const SITE_DESCRIPTION = "Car comparisons, reviews and auto news — every figure sourced and checked.";

// Real, site-wide gap found and fixed 2026-09-09 (user directly asked
// "will Google rank this?" while reviewing the site — checked live and
// found zero Open Graph/Twitter Card tags anywhere, not just on article
// pages). A site-wide default here covers every page that doesn't set
// its own (the homepage, car pages, topic pages, /about/*, search); the
// article page overrides with real per-article title/description/image
// via its own generateMetadata() (Next's Metadata API merges a child
// route's returned object over the parent's, not by replacing whole
// fields wholesale — an article's own `openGraph` object fully replaces
// this one for that route, it doesn't need to spread these defaults in).
// SEO pass (2026-09-11): a `title` template, not a flat string — every
// page below that sets its own string `title` (guides/brands/search's
// literal "Guides"/"Brands"/"Search", topics' "{name} — Latest
// Stories", articles' real headline, and the new per-page titles added
// this pass on the homepage/car/brand pages) is now automatically
// suffixed with the site name by Next's own title-template mechanism,
// so no page has to remember to append it — and neither does whatever
// page type gets added next. `default` only applies where a page sets
// no title at all (there shouldn't be any left after this pass, but it
// stays as the honest fallback rather than an empty tab title). See
// SEO.md for the full title/description convention this documents.
export const metadata: Metadata = {
  title: { default: `${SITE_NAME} — Automotive Intelligence`, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    title: `${SITE_NAME} — Automotive Intelligence`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
  },
  twitter: {
    card: "summary",
    title: `${SITE_NAME} — Automotive Intelligence`,
    description: SITE_DESCRIPTION,
  },
};

// spec §29: Organization + WebSite structured data on every page.
// BreadcrumbList (car/topic/article pages) and NewsArticle (article
// pages, apps/web/src/app/articles/[locale]/[slug]/page.tsx — added
// 2026-09-09 once real Articles existed to describe) join per-page.
// ImageObject stays deferred — no page names a standalone image entity
// yet, only images embedded within an Article's own JSON-LD.
function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
  };
}

function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    // Real now that /search actually works (spec §32) — was not added
    // before the search feature existed, since a SearchAction pointing at
    // a page that doesn't search anything would be exactly the kind of
    // structured-data claim spec §70 rules out.
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter, 2026-09-16 premium-redesign pass — no next/font in
            this app (see next.config.mjs's own CSP comment for why), a
            plain Google Fonts <link> is the lowest-risk way to add one
            real typeface. preconnect first so the actual stylesheet
            request doesn't pay a fresh DNS+TLS handshake on top of it. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body>
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          // Real, severe XSS gap found and fixed 2026-09-08 — see
          // packages/seo/src/breadcrumb.ts's safeJsonLdString() for the
          // full story: raw JSON.stringify() doesn't escape `<`, so a
          // literal `</script>` inside JSON-LD data closes this real
          // tag early. Low-risk here specifically (SITE_NAME/SITE_URL
          // come from env vars, not user input) but fixed for
          // consistency with the real, proven-exploitable case (the
          // car page's admin-editable brand/model names).
          dangerouslySetInnerHTML={{ __html: safeJsonLdString(organizationJsonLd()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLdString(websiteJsonLd()) }}
        />
        <header className="site">
          <div className="wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <a href="/" className="wordmark">
              {SITE_NAME}
              <span className="tagline">Premium Auto News &amp; Comparisons</span>
            </a>
            <HeaderNav />
          </div>
        </header>
        <main className="wrap" style={{ paddingTop: 24, paddingBottom: 60 }}>
          {children}
        </main>
        {/* Real gap found and fixed 2026-09-09, during a full portal
            review: there was no footer anywhere on the site — every
            /about/* page (including how-we-use-ai, the one page whose
            entire purpose is AI-disclosure transparency) was reachable
            only by typing its exact URL, linked from nowhere a normal
            visitor would ever click. Topic links repeat here (they also
            appear inline on article cards) since a footer is the one
            place a reader expects sitewide navigation regardless of which
            page they landed on. */}
        <footer className="site">
          <div className="wrap" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 32 }}>
            {/* Wordmark column added 2026-09-16 redesign — the mockups'
                own footer leads with the brand + one line of positioning
                rather than jumping straight into link columns; every
                link below is unchanged from the 2026-09-09 footer, only
                the layout/typography around them changed. */}
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 18, color: "#fff", marginBottom: 8 }}>{SITE_NAME}</div>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: 13.5, lineHeight: 1.6, color: "#9aa3af", maxWidth: 260, margin: 0 }}>
                Car comparisons, reviews and auto news — every figure sourced and checked.
              </p>
            </div>
            <div className="footer-links">
              <a href="/topics/electric-vehicles">Electric Vehicles</a>
              <a href="/topics/autonomous-robotaxi">Autonomous &amp; Robotaxis</a>
              <a href="/topics/micromobility">E-Bikes &amp; Scooters</a>
              <a href="/topics/market-business">Market &amp; Business</a>
              <a href="/topics/safety-recalls">Safety &amp; Recalls</a>
            </div>
            <div className="footer-links">
              <a href="/news">News</a>
              <a href="/comparisons">Comparisons &amp; Analysis</a>
              <a href="/brands">Brands</a>
              <a href="/guides">Guides</a>
              <a href="/compare">Compare cars</a>
            </div>
            <div className="footer-links">
              <a href="/about">About</a>
              <a href="/about/editorial-policy">Editorial Policy</a>
              <a href="/about/how-we-use-ai">How we use AI</a>
              <a href="/about/corrections">Corrections</a>
              <a href="/about/contact">Contact</a>
            </div>
          </div>
          <div className="wrap" style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)", fontFamily: "var(--font-sans)", fontSize: 13, color: "#7c8592" }}>
            &copy; {new Date().getFullYear()} {SITE_NAME}
            {/* Ownership credit added 2026-09-17, user's own direct ask
                ("куда-нибудь добавь. только не сильно") — deliberately
                placed in the smallest, most muted line on the page (the
                copyright bar, not the wordmark column above it) rather
                than anywhere more prominent. Real, honest attribution;
                not meant to read as cross-promotion. */}
            {" · "}
            <a href="https://qirastudio.com/" rel="noopener noreferrer" target="_blank" style={{ color: "inherit" }}>
              A project by Qira Studio
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
