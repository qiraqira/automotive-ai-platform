import { describe, expect, it } from "vitest";
import { buildBreadcrumbJsonLd, safeJsonLdString } from "../breadcrumb.js";

describe("buildBreadcrumbJsonLd", () => {
  it("builds a real schema.org BreadcrumbList with 1-indexed positions", () => {
    const jsonLd = buildBreadcrumbJsonLd([
      { name: "Home", url: "https://DOMAIN.COM" },
      { name: "BMW 3 Series", url: "https://DOMAIN.COM/cars/bmw/3-series" },
    ]);
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://DOMAIN.COM" },
        { "@type": "ListItem", position: 2, name: "BMW 3 Series", item: "https://DOMAIN.COM/cars/bmw/3-series" },
      ],
    });
  });

  it("derives position from array order, not anything the caller passes in", () => {
    const jsonLd = buildBreadcrumbJsonLd([
      { name: "Home", url: "https://DOMAIN.COM" },
      { name: "About", url: "https://DOMAIN.COM/about" },
      { name: "Contact", url: "https://DOMAIN.COM/about/contact" },
    ]);
    expect(jsonLd.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
  });
});

describe("safeJsonLdString", () => {
  // Real, severe XSS gap found and fixed 2026-09-08: apps/web injects
  // every real JSON-LD block via `dangerouslySetInnerHTML={{ __html:
  // JSON.stringify(data) }}` — plain `JSON.stringify()` does not escape
  // `<`, so a value containing the literal string `</script>` closes
  // the real `<script type="application/ld+json">` tag early, letting
  // anything after it run as real HTML/script. The car page's real
  // breadcrumb interpolates `carModel.brand.name`/`carModel.name`
  // directly — real, admin-settable strings with no character
  // restriction (`POST /v1/brands`/`POST /v1/cars` only require
  // `z.string().min(1)`) — making this a genuine stored XSS, not a
  // contrived one.
  it("escapes a literal </script> so it can never close the real script tag, while staying valid, equivalent JSON", () => {
    const malicious = buildBreadcrumbJsonLd([
      { name: "Home", url: "https://DOMAIN.COM" },
      { name: "Foo</script><script>alert(1)</script>", url: "https://DOMAIN.COM/cars/evil/model" },
    ]);
    const raw = JSON.stringify(malicious);
    expect(raw).toContain("</script>"); // proves JSON.stringify alone is genuinely unsafe
    const safe = safeJsonLdString(malicious);
    expect(safe).not.toContain("</script>");
    expect(safe).not.toContain("<script>");
    // Still valid, semantically identical JSON — `<` is a real,
    // spec-legal JSON string escape for `<`, so a real JSON-LD consumer
    // (a search engine, a browser's own JSON.parse) reads it back
    // exactly the same as the unescaped original.
    expect(JSON.parse(safe)).toEqual(malicious);
  });

  it("round-trips ordinary JSON-LD data unchanged in meaning", () => {
    const data = buildBreadcrumbJsonLd([{ name: "BMW 3 Series", url: "https://DOMAIN.COM/cars/bmw/3-series" }]);
    expect(JSON.parse(safeJsonLdString(data))).toEqual(data);
  });
});
