/** @type {import('next').NextConfig} */
const nextConfig = {
  // Deliberately minimal for now — i18n routing for /es/ (spec §22) still
  // waits on a real feature landing. Image domains (spec §27) landed
  // 2026-09-08: `img-src` below allows real Wikimedia Commons hero images
  // (apps/worker/src/fetch-images.ts) — plain <img> tags, not next/image
  // (this app deliberately ships close to zero client JS; next/image's
  // own optimizer/blur-placeholder JS isn't worth it for a handful of
  // hero images). Real gap found and fixed live the same day: Commons'
  // own API returns image URLs on more than one real subdomain
  // (`upload.wikimedia.org` for a full-size original, `thumb.wikimedia.org`
  // for a requested thumbnail width — this app always requests the
  // latter) — an `img-src` allowing only `upload.` silently CSP-blocked
  // every real hero image in a real browser (caught by inspecting the
  // real page HTML, not by testing in a browser that would have shown
  // the blocked-image console error). Widened to `https://*.wikimedia.org`
  // rather than enumerate subdomains one CSP violation at a time.

  // Real gap found and fixed 2026-09-07: this app sent zero security
  // headers beyond Next's own defaults, and `X-Powered-By: Next.js`
  // actively advertised the stack to fingerprint (confirmed via curl).
  poweredByHeader: false,
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    // Content-Security-Policy: the "without nonces" form from Next's own
    // docs (nextjs.org/docs/app/guides/content-security-policy), not the
    // nonce-based one — deliberately, after checking the tradeoff: a
    // nonce requires *every* page to opt into dynamic rendering (no
    // static generation, no ISR), and several real pages here
    // (/about/*, the homepage) are legitimately static today. This app
    // has zero external scripts/analytics and no next/font — every
    // resource is same-origin — so `'self'` covers everything real.
    // `'unsafe-inline'` on script-src/style-src is required, not
    // optional: Next injects its own inline hydration-data script on
    // every page, and this codebase styles almost everything via React's
    // `style={{...}}` prop, which compiles to real inline `style`
    // attributes — both are exactly what Next's own docs show
    // `'unsafe-inline'` for in this no-nonce form. `'unsafe-eval'` is
    // dev-only (React's own eval-based server-error-stack reconstruction
    // in the browser — Next's docs are explicit that production needs
    // neither React nor Next to eval anything).
    const cspHeader = `
      default-src 'self';
      script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: https://*.wikimedia.org;
      font-src 'self';
      connect-src 'self'${isDev ? " ws:" : ""};
      object-src 'none';
      base-uri 'self';
      form-action 'self';
      frame-ancestors 'none';
      frame-src https://www.youtube-nocookie.com;
      upgrade-insecure-requests;
    `
      .replace(/\s{2,}/g, " ")
      .trim();

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: cspHeader },
          // Real gap found and fixed 2026-09-07, in two passes the same
          // day: comparing this app's real live header output side by
          // side against `apps/api`'s (whose `helmet()` call sends a much
          // longer default list) first caught the missing
          // Strict-Transport-Security header, then a full, deliberate
          // head-to-head of *every* header both services actually send —
          // not just the one already found missing — caught these seven
          // more real ones `helmet()` sends by default that had no
          // equivalent here at all. `apps/web` is the actual public site
          // real browsers load, so it needs its own security-header
          // parity with `apps/api`, not less of it just because its
          // headers happen to be hand-listed here instead of coming from
          // a library's defaults. Cross-Origin-Opener-Policy and
          // Cross-Origin-Resource-Policy in particular are genuinely
          // meaningful (real, current process-isolation hardening against
          // Spectre-class cross-origin attacks), not legacy boilerplate —
          // `same-origin` is safe for both since this app has zero
          // external scripts/analytics/embeds and nothing here is
          // designed to be framed or fetched cross-origin (same
          // "everything is same-origin" fact CSP's own comment above
          // already establishes).
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "X-Download-Options", value: "noopen" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "X-XSS-Protection", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
