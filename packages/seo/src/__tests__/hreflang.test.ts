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
  // Real gap found and fixed 2026-09-14: /es/ pages don't exist anywhere
  // in apps/web yet, so an "es" alternate here 404s on every real page —
  // a genuine Search Console "hreflang points to a 404" error, not just
  // a theoretical one. buildHreflangAlternates() now gates the "es" entry
  // behind the module-private ES_LOCALE_LIVE flag (currently false) —
  // this test asserts today's real, correct behavior (en + x-default
  // only); flipping that flag once /es/ pages are real is the one change
  // that should ever make this test's expectation change too.
  it("returns en and x-default only while the Spanish edition isn't live yet", () => {
    const alternates = buildHreflangAlternates(SITE, "/cars/bmw/3-series");
    expect(alternates).toEqual([
      { hreflang: "en", href: "https://DOMAIN.COM/cars/bmw/3-series" },
      { hreflang: "x-default", href: "https://DOMAIN.COM/cars/bmw/3-series" },
    ]);
  });
});
