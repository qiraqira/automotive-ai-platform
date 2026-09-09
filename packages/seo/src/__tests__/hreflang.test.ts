import { describe, expect, it } from "vitest";
import { buildLocaleUrl, buildHreflangAlternates } from "../hreflang.js";

const SITE = "https://DOMAIN.COM";

describe("buildLocaleUrl", () => {
  it("puts English at the root, no /en/ prefix", () => {
    expect(buildLocaleUrl(SITE, "en", "/cars/bmw/3-series")).toBe("https://DOMAIN.COM/cars/bmw/3-series");
  });

  it("puts Spanish under /es/, not a subdomain or query param", () => {
    expect(buildLocaleUrl(SITE, "es", "/cars/bmw/3-series")).toBe("https://DOMAIN.COM/es/cars/bmw/3-series");
  });

  it("handles the homepage (empty path) for English", () => {
    expect(buildLocaleUrl(SITE, "en", "")).toBe("https://DOMAIN.COM");
  });

  it("handles the homepage (empty path) for Spanish", () => {
    expect(buildLocaleUrl(SITE, "es", "")).toBe("https://DOMAIN.COM/es");
  });

  it("is tolerant of a siteUrl with a trailing slash", () => {
    expect(buildLocaleUrl("https://DOMAIN.COM/", "en", "/cars/bmw/3-series")).toBe("https://DOMAIN.COM/cars/bmw/3-series");
  });

  it("is tolerant of a path without a leading slash", () => {
    expect(buildLocaleUrl(SITE, "en", "cars/bmw/3-series")).toBe("https://DOMAIN.COM/cars/bmw/3-series");
  });
});

describe("buildHreflangAlternates", () => {
  it("returns en, es, and x-default (pointing at English, the canonical primary locale)", () => {
    const alternates = buildHreflangAlternates(SITE, "/cars/bmw/3-series");
    expect(alternates).toEqual([
      { hreflang: "en", href: "https://DOMAIN.COM/cars/bmw/3-series" },
      { hreflang: "es", href: "https://DOMAIN.COM/es/cars/bmw/3-series" },
      { hreflang: "x-default", href: "https://DOMAIN.COM/cars/bmw/3-series" },
    ]);
  });
});
