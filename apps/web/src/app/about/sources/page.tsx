import type { Metadata } from "next";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getSources } from "@/lib/api";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// spec §67 "Sources" page + spec §35 "Source transparency" — the real,
// currently-active source list, not a curated marketing claim about
// "500+ sources" the system doesn't actually have yet (see
// docs/deployment.md's roadmap: source ecosystem growth is a later phase).
// Real gap found and fixed 2026-09-07: real hreflang/canonical (spec
// §22/§30), same fix as the rest of /about/* — see /about/page.tsx's
// fuller comment for why.
export const metadata: Metadata = {
  title: "Sources",
  description: "The sources we monitor and how we weigh their reliability.",
  alternates: {
    canonical: buildLocaleUrl(SITE_URL, "en", "/about/sources"),
    languages: Object.fromEntries(buildHreflangAlternates(SITE_URL, "/about/sources").map((a) => [a.hreflang, a.href])),
  },
};

const TIER_LABELS: Record<string, string> = {
  PRIMARY: "Primary (official)",
  WIRE: "Wire service",
  SPECIALIST: "Specialist automotive media",
  REGIONAL: "Regional media",
  SOCIAL_LEAD: "Social (leads only)",
  UNVERIFIED: "Unverified",
};

// spec §29: real BreadcrumbList, same reasoning as /about/page.tsx.
const breadcrumbJsonLd = buildBreadcrumbJsonLd([
  { name: "Home", url: SITE_URL },
  { name: "About", url: `${SITE_URL}/about` },
  { name: "Sources", url: `${SITE_URL}/about/sources` },
]);

export default async function SourcesPage() {
  const { sources } = await getSources();

  return (
    <article style={{ maxWidth: "68ch" }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <h1 style={{ fontSize: 28, margin: "4px 0 12px" }}>Sources</h1>
      <p>
        We currently monitor {sources.length} source{sources.length === 1 ? "" : "s"}. Each one
        carries a trust score that reflects both its editorial track record and its role (an
        official manufacturer statement is weighed differently than a specialist outlet, which is
        weighed differently than an unconfirmed social post) — see our{" "}
        <a href="/about/how-we-use-ai">how we use AI</a> page for how that score factors into fact
        checking.
      </p>
      <ul className="story-list">
        {sources.map((source) => (
          <li key={source.id} className="story-item">
            <div className="story-meta">
              {TIER_LABELS[source.tier] ?? source.tier} · trust score {source.trustScore}/100
            </div>
            <h2 style={{ fontSize: 18, margin: "4px 0" }}>
              <a href={source.url}>{source.name}</a>
            </h2>
          </li>
        ))}
      </ul>
    </article>
  );
}
