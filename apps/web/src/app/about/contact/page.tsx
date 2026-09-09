import type { Metadata } from "next";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// spec §67 Contact page. Deliberately does NOT invent a company name,
// email address, or physical presence — none of that exists yet for this
// project (PROJECT_NAME/DOMAIN.COM are still placeholders, see
// .env.example). Fabricating contact details would be exactly the kind
// of "fake" content spec §85/§70 rule out; this is a real TODO, not a
// disguised dead end.
// Real gap found and fixed 2026-09-07: real hreflang/canonical (spec
// §22/§30), same fix as the rest of /about/* — see /about/page.tsx's
// fuller comment for why.
export const metadata: Metadata = {
  title: "Contact",
  description: "How to reach us.",
  alternates: {
    canonical: buildLocaleUrl(SITE_URL, "en", "/about/contact"),
    languages: Object.fromEntries(buildHreflangAlternates(SITE_URL, "/about/contact").map((a) => [a.hreflang, a.href])),
  },
};

// spec §29: real BreadcrumbList, same reasoning as /about/page.tsx.
const breadcrumbJsonLd = buildBreadcrumbJsonLd([
  { name: "Home", url: SITE_URL },
  { name: "About", url: `${SITE_URL}/about` },
  { name: "Contact", url: `${SITE_URL}/about/contact` },
]);

export default function ContactPage() {
  return (
    <article style={{ maxWidth: "68ch" }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <h1 style={{ fontSize: 28, margin: "4px 0 20px" }}>Contact</h1>
      <p>
        Real contact details (an editorial email, a way to report a
        correction beyond what's on our{" "}
        <a href="/about/corrections">corrections page</a>) go here once this
        project has a real domain and team behind it — this page is a
        placeholder on purpose rather than a fabricated address.
      </p>
    </article>
  );
}
