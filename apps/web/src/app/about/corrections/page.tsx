import type { Metadata } from "next";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// spec §67-69: a real corrections policy page.
// Real gap found and fixed 2026-09-07: real hreflang/canonical (spec
// §22/§30), same fix as the rest of /about/* — see /about/page.tsx's
// fuller comment for why.
// Real, false claim found and fixed 2026-09-09, same review pass that
// caught /about/how-we-use-ai's stale claims: this page's own top comment
// asserted "every article change is a recorded ArticleRevision... matching
// what the system actually does" — checked directly and found zero real
// code anywhere ever creates one (`ArticleRevision` exists in
// schema.prisma for exactly this purpose, but nothing writes to it; there
// isn't even an admin route to edit a published article's content yet,
// only publish/reject). The page below asserted the same thing to
// readers. Rewritten to say what's actually true today rather than what
// the schema was designed to eventually support.
export const metadata: Metadata = {
  title: "Corrections",
  description: "How we handle mistakes after publication.",
  alternates: {
    canonical: buildLocaleUrl(SITE_URL, "en", "/about/corrections"),
    languages: Object.fromEntries(
      buildHreflangAlternates(SITE_URL, "/about/corrections").map((a) => [a.hreflang, a.href]),
    ),
  },
};

// spec §29: real BreadcrumbList, same reasoning as /about/page.tsx.
const breadcrumbJsonLd = buildBreadcrumbJsonLd([
  { name: "Home", url: SITE_URL },
  { name: "About", url: `${SITE_URL}/about` },
  { name: "Corrections", url: `${SITE_URL}/about/corrections` },
]);

export default function CorrectionsPage() {
  return (
    <article style={{ maxWidth: "68ch" }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <h1 style={{ fontSize: 28, margin: "4px 0 20px" }}>Corrections</h1>
      <p>
        We intend for every correction to be a recorded, visible revision —
        never a quiet rewrite — but that workflow is not built yet: there is
        currently no way to edit a published article through the product at
        all, correction or otherwise. Until it exists, we&rsquo;re saying so
        plainly here rather than describing a process that doesn&rsquo;t
        exist yet as if it already did.
      </p>
      <p>
        If you spot an error, use the <a href="/about/contact">contact
        page</a> to reach us and we&rsquo;ll fix it directly for now.
      </p>
      <p>
        See also: <a href="/about/how-we-use-ai">how we use AI</a> in this
        process.
      </p>
    </article>
  );
}
