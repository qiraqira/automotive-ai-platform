import { NextFetchEvent, NextRequest, NextResponse } from "next/server";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
// Real gap found and fixed 2026-09-07: neither fetch below had a
// timeout — this file runs on EVERY real page request (see `config`
// below), so a hung apps/api (a DB pool exhausted, a slow query, real
// operational trouble, not contrived) would block navigation site-wide
// forever. That directly defeats this function's own stated intent
// ("A redirect lookup failure must never break normal navigation") — a
// hang isn't a caught failure, it just never reaches the catch below.
const API_FETCH_TIMEOUT_MS = 10_000;

// spec §49 analytics — fire-and-forget via event.waitUntil so it never
// adds latency to the actual response; a failure here must never surface
// to the user (same swallow-and-continue posture as the redirect lookup
// below). Skips Next.js's own prefetch requests (a real "purpose:
// prefetch"/"next-router-prefetch" header, per Next's own proxy docs) so
// a link merely being visible on a page doesn't inflate pageview counts —
// only requests that are a genuine navigation get recorded.
function recordPageview(request: NextRequest, event: NextFetchEvent) {
  const isPrefetch = request.headers.get("purpose") === "prefetch" || request.headers.has("next-router-prefetch");
  if (isPrefetch) return;

  // Real gap found and fixed 2026-09-07: this call reaches `apps/api`
  // over an internal, server-to-server hop — Express's `req.ip` there
  // would otherwise resolve to *this* Next.js server's own address for
  // every real visitor, not the browser's, since production's real
  // nginx-set `X-Forwarded-For` (the header `trust proxy: 1` in
  // apps/api/src/app.ts is counting on) was already consumed reaching
  // this proxy and never continues past it on its own. Relaying the
  // same header value on unchanged is what lets a per-IP rate limit on
  // `POST /v1/analytics/events` actually key on distinct real visitors
  // instead of collapsing all of them onto this one process's address.
  const forwardedFor = request.headers.get("x-forwarded-for");

  event.waitUntil(
    fetch(`${API_INTERNAL_URL}/v1/analytics/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      },
      body: JSON.stringify({ type: "pageview", path: request.nextUrl.pathname }),
      signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
    }).catch(() => {
      // Analytics must never break navigation.
    }),
  );
}

// spec §29-31 / §38 "Redirects" — a real check against the Redirect table
// (via apps/api's /v1/redirects/lookup) on every request that isn't a
// Next.js internal/static asset path. Known simplification, documented
// rather than hidden: this is one extra network round-trip per
// navigation, acceptable at MVP redirect volume; if the Redirect table
// grows large or this measurably hurts latency, the fix is caching the
// active redirect set in-memory with a short TTL instead of a per-request
// lookup — not implemented now because there's exactly one seeded
// redirect to validate against, nowhere near the scale where that
// optimization would pay for itself.
//
// Named `proxy.ts`, not `middleware.ts` — Next.js 16 renamed the file
// convention (the export itself stays a function doing the same job, see
// node_modules/next/dist/docs/.../file-conventions/proxy.md "Migration to
// Proxy"). Caught via a real build warning, not assumed.
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  try {
    const lookupUrl = `${API_INTERNAL_URL}/v1/redirects/lookup?path=${encodeURIComponent(pathname)}`;
    const res = await fetch(lookupUrl, { cache: "no-store", signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS) });
    if (res.status === 200) {
      const redirect = (await res.json()) as { toPath: string; statusCode: number };
      const target = request.nextUrl.clone();
      target.pathname = redirect.toPath;
      return NextResponse.redirect(target, redirect.statusCode);
    }
  } catch {
    // A redirect lookup failure must never break normal navigation — fall
    // through and let the request proceed as if no redirect existed.
  }

  recordPageview(request, event);
  return NextResponse.next();
}

export const config = {
  // `uploads/` excluded 2026-09-08 alongside the new real hero-image
  // Route Handler (apps/web/src/app/uploads/[filename]/route.ts) —
  // these are requested on every page that shows a thumbnail (the
  // homepage alone can load several), so a redirect-lookup round trip to
  // apps/api plus a spurious analytics pageview per image request is
  // real, avoidable overhead for a path that's never going to have a
  // real content redirect anyway.
  matcher: ["/((?!_next/|api/|uploads/|favicon.ico|robots.txt|sitemap.xml).*)"],
};
