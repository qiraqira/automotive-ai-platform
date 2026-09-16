import { getNewsSitemapArticles } from "@/lib/api";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const SITE_NAME = process.env.PROJECT_NAME ?? "PROJECT_NAME";

// Real gap found and fixed 2026-09-17, user's own direct question about
// Google News readiness. sitemap.ts (Next's own reserved-filename
// convention) already lists every real published Article, but Google
// News specifically wants its own feed: only NEWS/BREAKING_NEWS content,
// only the last 48 hours, using the <news:news> sitemap extension with a
// real <news:title> — none of which the general sitemap carries, and
// Next's `MetadataRoute.Sitemap` type has no support for a custom XML
// namespace, so this is a hand-built XML Route Handler instead of the
// sitemap.ts convention used everywhere else on the site. GET
// /v1/news-sitemap-articles does the real filtering (type, publishedAt,
// quality gate); this only serializes its result to the exact XML shape
// https://www.google.com/schemas/sitemap-news/0.9 requires.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const { articles } = await getNewsSitemapArticles();

  const urls = articles
    .map((article) => {
      const loc = `${SITE_URL}/articles/${article.locale}/${article.slug}`;
      const pubDate = article.publishedAt ?? new Date().toISOString();
      return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(SITE_NAME)}</news:name>
        <news:language>${article.locale}</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${escapeXml(article.headline)}</news:title>
    </news:news>
  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Real news moves fast and this feed is time-scoped (48h) — a
      // short cache keeps it fresh for crawlers without hitting the API
      // on every single request.
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
