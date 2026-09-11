// Real, live-discovered gap found 2026-09-09 — user asked directly "will
// Google actually rank this?" while reviewing the site: a real published
// article page had zero Open Graph tags and zero Article/NewsArticle
// structured data (only the site-wide Organization/WebSite blocks from
// layout.tsx plus this page's own BreadcrumbList — real, but not what a
// search engine or a social-share unfurl actually reads for "what is
// this specific page about"). layout.tsx's own comment already correctly
// deferred this ("Article/NewsArticle/... JSON-LD join once those page
// types exist") — they do now (apps/worker/src/write-article.ts's real
// Writer stage), this closes that deferred gap for real.

export interface ArticleJsonLdInput {
  headline: string;
  description?: string;
  imageUrl?: string;
  datePublished: string;
  dateModified?: string;
  url: string;
  /** No human byline exists for AI-written content — spec's own
   * AI-transparency principle (see /about/how-we-use-ai) means this
   * should name the platform, not fabricate a human author. */
  authorName: string;
  publisherName: string;
  publisherLogoUrl?: string;
  /** SEO pass (2026-09-11): real gap — this was hardcoded to
   * "NewsArticle" for every Article regardless of type, including the
   * evergreen GUIDE/COMPARISON/ANALYSIS pieces this site also
   * publishes. Google's own structured-data guidance scopes
   * NewsArticle to actual news reporting; a comparison or how-to guide
   * is more accurately plain "Article". Defaults to "Article" — a
   * caller must opt into "NewsArticle" for genuinely time-sensitive
   * news content. */
  schemaType?: "NewsArticle" | "Article";
}

export function buildArticleJsonLd(input: ArticleJsonLdInput) {
  return {
    "@context": "https://schema.org",
    "@type": input.schemaType ?? "Article",
    headline: input.headline,
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    mainEntityOfPage: { "@type": "WebPage", "@id": input.url },
    author: { "@type": "Organization", name: input.authorName },
    publisher: {
      "@type": "Organization",
      name: input.publisherName,
      ...(input.publisherLogoUrl ? { logo: { "@type": "ImageObject", url: input.publisherLogoUrl } } : {}),
    },
  };
}
