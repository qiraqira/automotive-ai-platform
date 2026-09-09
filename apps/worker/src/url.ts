import { createHash } from "node:crypto";

/** Strips tracking params and normalizes case/trailing slash so the same
 * article reached via a different query string still hashes identically
 * (spec §13 "URL" as the first, cheapest duplicate-detection signal). */
export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  // Real gap found and fixed 2026-09-08: "ref" here (not "ref_") matched
  // as a bare prefix, so it also stripped any real, unrelated query
  // param that merely starts with those letters — "reference",
  // "refund", "refresh", "referrer" — none of which are referral-
  // tracking noise. Real-world "ref" tracking params are the exact key
  // "ref", or Twitter/Facebook's own "ref_src"/"ref_url" convention
  // (an underscore-delimited prefix) — never a same-word continuation.
  // A source using a genuine, distinguishing query param that happens
  // to start with those letters would have silently had it stripped
  // here, risking two actually-different articles normalizing to the
  // same URL and hashing as duplicates (a false-duplicate, not just a
  // cosmetic normalization difference). `utm_` was already correctly
  // underscore-delimited; `fbclid`/`gclid`/`mc_cid`/`mc_eid` are exact,
  // specific-enough strings already unlikely to collide with a real,
  // unrelated key.
  const stripPrefixes = ["utm_", "ref_", "fbclid", "gclid", "mc_cid", "mc_eid"];
  for (const key of [...url.searchParams.keys()]) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "ref" || stripPrefixes.some((p) => lowerKey.startsWith(p))) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  let path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
}

export function hashUrl(normalizedUrl: string): string {
  return createHash("sha256").update(normalizedUrl).digest("hex");
}
