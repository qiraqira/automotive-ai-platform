import { describe, expect, it } from "vitest";
import { buildArticleJsonLd } from "../article.js";

describe("buildArticleJsonLd", () => {
  // Test updated 2026-09-14: found failing during an unrelated SEO pass.
  // Not a regression in article.ts — that file's own 2026-09-11 comment
  // documents a deliberate change (schemaType now defaults to "Article";
  // a caller must opt into "NewsArticle" for genuinely time-sensitive
  // news, since Google's guidance scopes NewsArticle to real news
  // reporting, not comparisons/guides) — this test was just never
  // updated to match, and the real call site (the article page's own
  // generateMetadata) already passes schemaType correctly. Split into
  // two cases so both the default and the opt-in are actually covered.
  it("defaults to plain Article when schemaType isn't given", () => {
    const jsonLd = buildArticleJsonLd({
      headline: "BYD's new Defender-like SUV breaks cover",
      description: "A real subtitle.",
      imageUrl: "https://auto.kite99.com/uploads/x.png",
      datePublished: "2026-09-08T12:00:00.000Z",
      url: "https://auto.kite99.com/articles/en/byd-defender-like-suv",
      authorName: "Automotive AI Platform",
      publisherName: "Automotive AI Platform",
    });
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "BYD's new Defender-like SUV breaks cover",
      description: "A real subtitle.",
      image: ["https://auto.kite99.com/uploads/x.png"],
      datePublished: "2026-09-08T12:00:00.000Z",
      dateModified: "2026-09-08T12:00:00.000Z",
      mainEntityOfPage: { "@type": "WebPage", "@id": "https://auto.kite99.com/articles/en/byd-defender-like-suv" },
      author: { "@type": "Organization", name: "Automotive AI Platform" },
      publisher: { "@type": "Organization", name: "Automotive AI Platform" },
    });
  });

  it("uses NewsArticle when the caller opts in for genuinely time-sensitive news", () => {
    const jsonLd = buildArticleJsonLd({
      headline: "BYD's new Defender-like SUV breaks cover",
      datePublished: "2026-09-08T12:00:00.000Z",
      url: "https://auto.kite99.com/articles/en/byd-defender-like-suv",
      authorName: "Automotive AI Platform",
      publisherName: "Automotive AI Platform",
      schemaType: "NewsArticle",
    });
    expect(jsonLd["@type"]).toBe("NewsArticle");
  });

  it("omits description/image entirely when not given, rather than emitting empty/null fields", () => {
    const jsonLd = buildArticleJsonLd({
      headline: "A headline",
      datePublished: "2026-09-08T12:00:00.000Z",
      url: "https://auto.kite99.com/articles/en/a-headline",
      authorName: "Automotive AI Platform",
      publisherName: "Automotive AI Platform",
    });
    expect(jsonLd).not.toHaveProperty("description");
    expect(jsonLd).not.toHaveProperty("image");
  });

  it("defaults dateModified to datePublished when not given", () => {
    const jsonLd = buildArticleJsonLd({
      headline: "A headline",
      datePublished: "2026-09-08T12:00:00.000Z",
      url: "https://auto.kite99.com/articles/en/a-headline",
      authorName: "Automotive AI Platform",
      publisherName: "Automotive AI Platform",
    });
    expect(jsonLd.dateModified).toBe("2026-09-08T12:00:00.000Z");
  });

  it("includes publisher.logo only when a real logo URL is given", () => {
    const withLogo = buildArticleJsonLd({
      headline: "A headline",
      datePublished: "2026-09-08T12:00:00.000Z",
      url: "https://auto.kite99.com/articles/en/a-headline",
      authorName: "Automotive AI Platform",
      publisherName: "Automotive AI Platform",
      publisherLogoUrl: "https://auto.kite99.com/logo.png",
    });
    expect(withLogo.publisher).toEqual({
      "@type": "Organization",
      name: "Automotive AI Platform",
      logo: { "@type": "ImageObject", url: "https://auto.kite99.com/logo.png" },
    });
  });
});
