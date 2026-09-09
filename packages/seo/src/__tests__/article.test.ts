import { describe, expect, it } from "vitest";
import { buildArticleJsonLd } from "../article.js";

describe("buildArticleJsonLd", () => {
  it("builds a real schema.org NewsArticle with the given fields", () => {
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
      "@type": "NewsArticle",
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
