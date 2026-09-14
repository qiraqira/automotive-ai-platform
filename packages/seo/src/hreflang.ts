// hreflang/canonical URL construction (spec §22, §30). English is
// canonical at the site root; Spanish lives under /es/ (spec §30 — NOT
// en.domain.com / es.domain.com subdomains, NOT a query param). This is a
// pure string-building function so apps/web can call it from any page
// without needing to know the URL scheme itself — the scheme lives in
// exactly one place, here.

export type Locale = "en" | "es";

export interface HreflangAlternate {
  hreflang: string;
  href: string;
}

function stripLeadingSlash(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** [siteUrl] must not have a trailing slash requirement — this normalizes
 * it. [path] is locale-neutral, e.g. "/cars/bmw/3-series" or "" for the
 * homepage. */
export function buildLocaleUrl(siteUrl: string, locale: Locale, path: string): string {
  const base = stripTrailingSlash(siteUrl);
  const cleanPath = stripLeadingSlash(path);

  if (locale === "en") {
    return cleanPath ? `${base}/${cleanPath}` : base;
  }
  // spec §30: Spanish article/category URLs are also locale-specific
  // slugs, not a 1:1 mirror of the English path — but the /es/ prefix
  // itself is fixed regardless of what follows it.
  return cleanPath ? `${base}/es/${cleanPath}` : `${base}/es`;
}

// Real gap found and fixed 2026-09-14 during an SEO pass: every page on
// the site declares an "es" hreflang alternate per spec §30's planned
// Spanish edition, but /es/* pages don't exist yet anywhere in apps/web
// — every one of those alternates 404s. That doesn't block Google from
// indexing the real English page, but it does surface as a real
// "hreflang points to a 404" error in Search Console's International
// Targeting report, right as this site is about to be submitted there
// for the first time. Gated behind a single flag here — flipping it to
// true once /es/ pages are real is the only change needed, with zero
// changes at any of this function's 28 call sites across apps/web.
const ES_LOCALE_LIVE = false;

/** Builds the full hreflang set for a page: one entry per supported
 * locale plus x-default pointing at English (the canonical primary
 * locale, spec §2). Order doesn't matter for correctness but is kept
 * stable (en, es, x-default) so snapshot/diff-based tests don't churn on
 * unrelated changes. */
export function buildHreflangAlternates(siteUrl: string, path: string): HreflangAlternate[] {
  return [
    { hreflang: "en", href: buildLocaleUrl(siteUrl, "en", path) },
    ...(ES_LOCALE_LIVE ? [{ hreflang: "es", href: buildLocaleUrl(siteUrl, "es", path) }] : []),
    { hreflang: "x-default", href: buildLocaleUrl(siteUrl, "en", path) },
  ];
}
