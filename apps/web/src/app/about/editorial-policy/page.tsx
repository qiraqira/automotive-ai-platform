import type { Metadata } from "next";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// spec §67 Editorial Policy page. Describes real, implemented rules
// (source tiers exist in the schema/seed data, fact status values exist
// and are genuinely shown to readers on /cars/:brand/:model — verified by
// checking that page's own render code, not assumed from the schema — and
// the no-fake-authority rule is enforced via authorType on every article)
// — not aspirational promises about a fully autonomous system that
// doesn't run yet (see /about/how-we-use-ai for that distinction).
// Real gap found 2026-09-09, same review pass as the how-we-use-ai/
// corrections fixes: the "Independence of sources" claim below was NOT
// actually true at the time — packages/editorial's countIndependentOrigins()/
// groupByInformationOrigin() were real and unit-tested, but nothing in the
// live pipeline called either one. Corrected to say so honestly, then
// wired for real the same day (user's explicit request): those functions
// group by an `originUrl` field that turned out not to exist anywhere on
// the real SourceArticle schema (checked before wiring, not assumed) — a
// literal call would have been theater, contributing zero real signal.
// apps/worker/src/write-article.ts's countIndependentOriginsByEmbedding()
// (see its own comment) uses SourceArticle.embedding instead — already
// computed at ingest time for duplicate detection — grouping sources
// whose headlines are near-identical (very high cosine similarity,
// suggesting shared wire copy) as one origin. Approximate, not the exact
// "detected the actual press release" mechanism the paragraph below once
// implied, but real: it now genuinely shapes the Fact Checker's
// sourceScore judgment on every article, not a static claim about intent.
// Real gap found and fixed 2026-09-07: real hreflang/canonical (spec
// §22/§30), same fix as the rest of /about/* — see /about/page.tsx's
// fuller comment for why.
export const metadata: Metadata = {
  title: "Editorial Policy",
  description: "How we source, verify, and publish automotive coverage.",
  alternates: {
    canonical: buildLocaleUrl(SITE_URL, "en", "/about/editorial-policy"),
    languages: Object.fromEntries(
      buildHreflangAlternates(SITE_URL, "/about/editorial-policy").map((a) => [a.hreflang, a.href]),
    ),
  },
};

// spec §29: real BreadcrumbList, same reasoning as /about/page.tsx.
const breadcrumbJsonLd = buildBreadcrumbJsonLd([
  { name: "Home", url: SITE_URL },
  { name: "About", url: `${SITE_URL}/about` },
  { name: "Editorial Policy", url: `${SITE_URL}/about/editorial-policy` },
]);

export default function EditorialPolicyPage() {
  return (
    <article style={{ maxWidth: "68ch" }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <h1 style={{ fontSize: 28, margin: "4px 0 20px" }}>Editorial Policy</h1>

      <h2 style={{ fontSize: 18 }}>Sourcing</h2>
      <p>
        Every source we monitor carries a trust tier — official
        manufacturer statements and regulatory filings are weighed
        differently from specialist automotive media, which is weighed
        differently from an unconfirmed social post. See our{" "}
        <a href="/about/sources">sources page</a> for the current list and
        their tiers.
      </p>

      <h2 style={{ fontSize: 18 }}>Facts have a status, not just a value</h2>
      <p>
        A number in our system is never just a number. It carries a status —
        confirmed, reported, unconfirmed, rumor, or disputed — and that
        status is meant to be visible to readers where it matters, not
        buried in a database only we can see.
      </p>

      <h2 style={{ fontSize: 18 }}>Headlines describe what happened</h2>
      <p>
        We do not use headlines designed to provoke a click rather than
        inform — no manufactured urgency, no misleading numbers, no
        withheld subject.
      </p>

      <h2 style={{ fontSize: 18 }}>Independence of sources</h2>
      <p>
        Ten outlets republishing the same press release are one piece of
        information, not ten independent confirmations. Before an article
        is scored, we group its sources by how closely their wording
        matches — near-identical headlines are treated as one origin, not
        several — so a story with many outlets but little real independent
        confirmation is scored accordingly, not credited as if it had more
        corroboration than it does. This is an approximate signal (based
        on how similarly worded the coverage is, not a confirmed trace to
        one specific original report), and we&rsquo;d rather describe it
        that way than overstate its precision.
      </p>

      <h2 style={{ fontSize: 18 }}>AI's role</h2>
      <p>
        See <a href="/about/how-we-use-ai">how we use AI</a> for a specific,
        current account of what is and isn't automated in our process.
      </p>

      <h2 style={{ fontSize: 18 }}>When we're wrong</h2>
      <p>
        See our <a href="/about/corrections">corrections policy</a>.
      </p>
    </article>
  );
}
