// spec §29: BreadcrumbList structured data. Deliberately independent of
// the Article/NewsArticle/ImageObject JSON-LD still correctly deferred
// in apps/web/src/app/layout.tsx — those need a real article or a real
// photo to describe (neither exists yet), but a breadcrumb only needs
// real pages to link to, which car/topic/about pages already are.

export interface BreadcrumbItem {
  name: string;
  url: string;
}

/** Builds a real schema.org BreadcrumbList from an ordered list of real
 * pages, starting at the site root. Positions are 1-indexed per the
 * schema.org spec, derived from array order rather than passed in
 * separately, so callers can't accidentally desync name/url/position. */
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// Real, severe gap found and fixed 2026-09-08: every real JSON-LD block
// in apps/web (this breadcrumb, plus layout.tsx's Organization/WebSite
// blocks) was injected via `dangerouslySetInnerHTML={{ __html:
// JSON.stringify(data) }}` with no escaping at all — verified live
// (`node -e`) that `JSON.stringify()` does NOT escape `<`, so a value
// containing the literal string `</script>` closes the real `<script
// type="application/ld+json">` tag early, letting anything after it run
// as real, arbitrary HTML/script. This breadcrumb's own real car-page
// caller interpolates `carModel.brand.name`/`carModel.name` directly —
// real, admin-settable strings via `POST /v1/brands`/`POST /v1/cars`
// (only `z.string().min(1)`, no character restriction of any kind) —
// making this a genuine STORED XSS: an authenticated editor entering a
// brand/model name containing `</script><script>...</script>` (a
// mistake or a compromised/malicious admin account, not a hypothetical)
// would have that script execute in every real visitor's browser on
// that public car page. Standard, well-established mitigation for
// exactly this "JSON-LD in a script tag" pattern: escape every literal
// `<` to its unicode escape `<` — still valid, spec-correct JSON
// (a JSON string may contain a `\uXXXX` escape for any character), so
// search engines/JSON-LD consumers parse it identically, but the raw
// HTML source never contains a literal `<` for a browser to interpret
// as a tag boundary.
export function safeJsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
