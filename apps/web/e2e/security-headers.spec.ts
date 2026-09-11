import { test, expect } from "@playwright/test";

// Real gap found and fixed 2026-09-07: this app sent zero security
// headers beyond Next's own defaults, confirmed via curl. Fixed in
// next.config.mjs (poweredByHeader: false + a headers() function) —
// locked in here so a config regression fails a real test, not just a
// manual curl check someone has to remember to redo.

test("homepage carries the real security headers and never advertises the framework", async ({ request }) => {
  const res = await request.get("/");
  const headers = res.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  // Real test-coverage gap found and fixed 2026-09-08: this only ever
  // checked the header was PRESENT, unlike every other header in this
  // same test — a regression that changed next.config.mjs's real
  // Permissions-Policy value (e.g. accidentally re-enabling camera/mic/
  // geolocation) would still have passed. Verified the real configured
  // value directly in next.config.mjs before asserting it.
  expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
  expect(headers["x-powered-by"]).toBeUndefined();
});

// Real gap found and fixed 2026-09-07 (same day, later pass): every
// other security header above was added when this app's headers were
// first audited, but HSTS was missed entirely — confirmed live via curl
// that `apps/api` already sent a real Strict-Transport-Security header
// (one of helmet()'s own defaults) while this app, the actual
// public-facing site, sent none at all.
test("homepage carries a real Strict-Transport-Security header, matching apps/api's own", async ({ request }) => {
  const res = await request.get("/");
  const headers = res.headers();
  expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
});

// Real gap found and fixed 2026-09-07 (same day, one more pass): a full
// head-to-head of every header both real services actually send (not
// just the one already found missing above) caught seven more real
// ones helmet() sends by default with no equivalent here at all —
// Cross-Origin-Opener-Policy/Cross-Origin-Resource-Policy in particular
// are genuine, current process-isolation hardening, not legacy
// boilerplate.
test("homepage carries the real cross-origin isolation and legacy-hardening headers, matching apps/api's helmet() defaults", async ({ request }) => {
  const res = await request.get("/");
  const headers = res.headers();
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["origin-agent-cluster"]).toBe("?1");
  expect(headers["x-dns-prefetch-control"]).toBe("off");
  expect(headers["x-download-options"]).toBe("noopen");
  expect(headers["x-permitted-cross-domain-policies"]).toBe("none");
  expect(headers["x-xss-protection"]).toBe("0");
});

// Real Content-Security-Policy added 2026-09-07 — the "without nonces"
// form from Next's own docs (a nonce would force every page into dynamic
// rendering, which would be a real regression to this app's legitimately
// static pages). Verified manually via a real Chromium instance (Next's
// dev server *and* a real production build+start) with console
// monitoring for CSP violations before this was ever committed — zero
// violations on any real page, including the one fetch-based admin login
// flow. This test runs against the dev server (playwright.config.ts),
// so it asserts the dev-mode value (`'unsafe-eval'` + `ws:` — both
// removed in the real production build, verified separately by hand
// since `npm run e2e` doesn't build/start production).
test("homepage carries a real Content-Security-Policy with no external origins allowed beyond the two deliberate exceptions", async ({ request }) => {
  // Real gap found and fixed 2026-09-09, this repo's first real GitHub
  // Actions run: this test's own title/assertion said "no external
  // origins allowed anywhere" — true when it was written, but
  // next.config.mjs's `img-src` was deliberately widened 2026-09-08 to
  // `'self' data: https://*.wikimedia.org` for real Wikimedia Commons
  // hero images (the live homepage really does load them — see that
  // file's own comment). The blanket regex went stale the same day it
  // was invalidated and nothing caught it until a real header was
  // actually asserted against in CI. Now asserts the one deliberate
  // exception is present and that it's still the ONLY external origin
  // anywhere in the header, rather than re-asserting a blanket "none".
  //
  // Second deliberate exception added 2026-09-11: `frame-src
  // https://www.youtube-nocookie.com` for the real CarVideo embeds on
  // /cars/:brand/:model (user's own ask — official manufacturer and
  // crash-test videos playable on the model page, not just linked out).
  // The privacy-enhanced youtube-nocookie.com domain is used specifically
  // so the embed doesn't set a YouTube cookie until a visitor actually
  // presses play.
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"];
  expect(csp).toBeDefined();
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("img-src 'self' data: https://*.wikimedia.org");
  expect(csp).toContain("frame-src https://www.youtube-nocookie.com");
  const externalOrigins = csp!.match(/https?:\/\/(?!localhost)\S*/g) ?? [];
  for (const origin of externalOrigins) {
    expect(origin).toMatch(/^https:\/\/(\*\.wikimedia\.org|www\.youtube-nocookie\.com);?$/);
  }
});
