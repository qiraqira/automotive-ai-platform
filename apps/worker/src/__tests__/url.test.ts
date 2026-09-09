import { describe, expect, it } from "vitest";
import { normalizeUrl, hashUrl } from "../url.js";

describe("normalizeUrl", () => {
  it("strips common tracking params", () => {
    const a = normalizeUrl("https://example.com/article?utm_source=rss&utm_medium=feed&id=42");
    expect(a).toBe("https://example.com/article?id=42");
  });

  it("strips fbclid/gclid/mc_cid/mc_eid regardless of position", () => {
    const a = normalizeUrl("https://example.com/x?id=1&fbclid=abc&gclid=def&mc_cid=g&mc_eid=h");
    expect(a).toBe("https://example.com/x?id=1");
  });

  it("drops a trailing slash", () => {
    expect(normalizeUrl("https://example.com/article/")).toBe("https://example.com/article");
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://example.com/article#section-2")).toBe("https://example.com/article");
  });

  it("lowercases the host but leaves the path case alone", () => {
    expect(normalizeUrl("https://Example.COM/Article")).toBe("https://example.com/Article");
  });

  it("two URLs that differ only by tracking params normalize identically", () => {
    const a = normalizeUrl("https://example.com/story?utm_source=twitter");
    const b = normalizeUrl("https://example.com/story?utm_source=newsletter&utm_campaign=x");
    expect(a).toBe(b);
  });

  it("strips the exact 'ref' key and Twitter/Facebook's own 'ref_src'/'ref_url' convention", () => {
    expect(normalizeUrl("https://example.com/article?id=1&ref=twitter")).toBe("https://example.com/article?id=1");
    expect(normalizeUrl("https://example.com/article?id=1&ref_src=twsrc")).toBe("https://example.com/article?id=1");
  });

  // Real gap found and fixed 2026-09-08: "ref" used to match as a bare
  // prefix, so it also stripped any real, unrelated param merely
  // starting with those letters — not just referral-tracking noise.
  // These are real, plausible query param names a source could
  // legitimately use to distinguish two actually-different articles;
  // silently stripping them would make normalizeUrl (and the URL-hash
  // duplicate detection built on it) treat two different articles as
  // the same one.
  it("does NOT strip a real, unrelated query param that merely starts with the same letters as 'ref'", () => {
    expect(normalizeUrl("https://example.com/article?reference=abc123")).toBe("https://example.com/article?reference=abc123");
    expect(normalizeUrl("https://example.com/article?refund=processed")).toBe("https://example.com/article?refund=processed");
    expect(normalizeUrl("https://example.com/article?referrer=direct")).toBe("https://example.com/article?referrer=direct");
  });
});

describe("hashUrl", () => {
  it("is deterministic", () => {
    const url = "https://example.com/article";
    expect(hashUrl(url)).toBe(hashUrl(url));
  });

  it("produces different hashes for different URLs", () => {
    expect(hashUrl("https://example.com/a")).not.toBe(hashUrl("https://example.com/b"));
  });

  it("is a 64-char hex sha256 digest", () => {
    expect(hashUrl("https://example.com/a")).toMatch(/^[0-9a-f]{64}$/);
  });
});
