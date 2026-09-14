import type { Metadata } from "next";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// spec §67 "About" page + index for the whole /about/ section. Describes
// the actual mission and current build stage — no invented founding
// story, team, or history, since none exists yet (this is a from-scratch
// build, not an established outlet with one to tell).
// Real, false claim found and fixed 2026-09-09, same review pass as
// /about/how-we-use-ai: "automated article writing is not turned on yet"
// was true when this page was first written and stale from the moment
// the real Writer stage went live — same bug, same fix, see that page's
// own comment for the fuller story.
// Real gap found and fixed 2026-09-07: the homepage/car/topic pages
// already emit real hreflang/canonical (spec §22/§30) — this page and
// its 5 siblings under /about/ never did, the same "inconsistency, not a
// deliberate scope cut" the homepage's own fix already called out for
// itself. The /es/ edition doesn't exist yet, same as everywhere else —
// still correct to declare the alternate now (Google tolerates a
// not-yet-live alternate far better than a page that never declares one).
export const metadata: Metadata = {
  title: "About",
  description: "What this platform is and how it's built.",
  alternates: {
    canonical: buildLocaleUrl(SITE_URL, "en", "/about"),
    languages: Object.fromEntries(buildHreflangAlternates(SITE_URL, "/about").map((a) => [a.hreflang, a.href])),
  },
};

const LINKS = [
  { href: "/about/editorial-policy", label: "Editorial Policy" },
  { href: "/about/how-we-use-ai", label: "How we use AI" },
  { href: "/about/corrections", label: "Corrections" },
  { href: "/about/contact", label: "Contact" },
];

// spec §29: real BreadcrumbList, same reasoning as the car/topic pages
// (see apps/web/src/app/cars/[brand]/[model]/page.tsx's own comment).
const breadcrumbJsonLd = buildBreadcrumbJsonLd([
  { name: "Home", url: SITE_URL },
  { name: "About", url: `${SITE_URL}/about` },
]);

export default function AboutPage() {
  return (
    <article style={{ maxWidth: "68ch" }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <h1 style={{ fontSize: 28, margin: "4px 0 20px" }}>About</h1>
      <p>
        This is an automotive news and reference platform being built around
        a simple idea: instead of just republishing what other outlets
        report, connect coverage of the same event, verify what's actually
        known, and build a lasting reference (car specifications, history,
        comparisons) out of it — so a reader gets more than any single
        source gave them.
      </p>
      <p>
        We are early. Real source monitoring, duplicate/story detection, and
        a small real automotive database are running. Our content is created
        by people with the assistance of AI (Anthropic&rsquo;s Claude) and
        reviewed by people before publication — see{" "}
        <a href="/about/how-we-use-ai">how we use AI</a> for the exact,
        current state, including what we haven&rsquo;t built yet.
      </p>
      <h2 style={{ fontSize: 18 }}>More</h2>
      <ul>
        {LINKS.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
    </article>
  );
}
