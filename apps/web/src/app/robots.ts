import type { MetadataRoute } from "next";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// spec §29-31. /admin/ IS part of apps/web's own origin (unlike apps/api,
// a genuinely separate service never crawled as part of this site) — an
// earlier version of this file's comment conflated the two and left
// /admin/ crawlable by omission. Fixed here (robots.txt) AND per-page via
// `noindex` metadata on every /admin/* page (defense in depth: robots.txt
// is advisory and a crawler can ignore it, so the pages being gated by a
// real session check plus carrying their own noindex both still matter).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/admin/" },
    // news-sitemap.xml added 2026-09-17 (see that route's own comment) —
    // listing both here is the standard way to expose more than one
    // sitemap; Google News specifically looks for a sitemap using the
    // news:// extension, which the general sitemap.xml doesn't carry.
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/news-sitemap.xml`],
  };
}
