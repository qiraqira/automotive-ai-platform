import type { Metadata } from "next";
import { safeJsonLdString } from "@automotive/seo";
import "./globals.css";

// PROJECT_NAME/DOMAIN.COM are placeholders (see .env.example) — swapping
// the real brand name later is a metadata-only change, not an
// architecture change.
const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const SITE_NAME = process.env.PROJECT_NAME ?? "PROJECT_NAME";

const SITE_DESCRIPTION = "Global automotive news, research, and knowledge graph.";

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
export const metadata: Metadata = {
  title: `${SITE_NAME} — Automotive Intelligence`,
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
          <div className="wrap">
            <a href="/" className="wordmark">
              {SITE_NAME}
            </a>
            <a href="/search" style={{ float: "right", fontFamily: "Arial, sans-serif", fontSize: 13 }}>
              Search
            </a>
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
          <div className="wrap">
            <div className="footer-links">
              <a href="/topics/electric-vehicles">Electric Vehicles</a>
              <a href="/topics/autonomous-robotaxi">Autonomous &amp; Robotaxis</a>
              <a href="/topics/micromobility">E-Bikes &amp; Scooters</a>
              <a href="/topics/market-business">Market &amp; Business</a>
              <a href="/topics/safety-recalls">Safety &amp; Recalls</a>
            </div>
            <div className="footer-links">
              <a href="/brands">Brands</a>
              <a href="/guides">Guides</a>
            </div>
            <div className="footer-links">
              <a href="/about">About</a>
              <a href="/about/editorial-policy">Editorial Policy</a>
              <a href="/about/how-we-use-ai">How we use AI</a>
              <a href="/about/sources">Sources</a>
              <a href="/about/corrections">Corrections</a>
              <a href="/about/contact">Contact</a>
            </div>
            <div>
              &copy; {new Date().getFullYear()} {SITE_NAME}
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
