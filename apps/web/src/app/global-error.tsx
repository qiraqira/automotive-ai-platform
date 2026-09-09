"use client";

import "./globals.css";

// Real gap found 2026-09-07 (same day, one more pass) — status:
// PARTIALLY fixed, with a real, documented, unresolved uncertainty
// below, not a confident "fixed." Re-verified error.tsx's own already-
// documented fix (a real production `next build && next start` against
// a deliberately-killed apps/api, the exact method that file's own
// comment describes) and found it no longer holds: the raw SSR HTML
// response is `<html id="__next_error__">` wrapping only a minimal
// React Flight/RSC bootstrap script, with NEITHER error.tsx's nor this
// file's own rendered text ("Something went wrong"/"Try again")
// anywhere in the response body — confirmed by direct byte-for-byte
// comparison against a real, healthy page's response (which DOES
// contain its full real content directly in the raw HTML, e.g. "3
// Series"), not assumed from the status code alone. Isolated the cause
// with a minimal, dependency-free diagnostic page (`throw new
// Error(...)` directly, no fetch, no apps/api) in both `next start` and
// `next dev` — route-level error.tsx caught NEITHER. Per this exact
// Next.js version's own bundled reference doc
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-
// conventions/error.md's "Version History" table): the `retry` prop
// only became stable in v16.3.0; this project runs v16.3.4, four patch
// releases later — plausibly a real, version-specific regression in
// this very recently stabilized area of the framework, not something
// fixable from application code.
//
// This file (`global-error.js`) was added as the next-best documented
// mechanism, but its own effect could NOT be conclusively verified
// either way in this environment: Next's Flight protocol appears to
// resolve which error boundary actually renders during CLIENT-SIDE
// hydration for this failure mode, not synchronously in the raw SSR
// response — curl can only ever see the latter. The one tool available
// here for real browser JS execution could not reach ANY `localhost`
// port at all in this sandbox, including known-healthy pages, so it
// could not confirm or refute whether a real browser successfully
// hydrates into this component's rendered output. Kept this file
// anyway since it's genuinely spec-compliant, valid per Next's own
// docs, and can only help, never hurt, regardless of that uncertainty
// — but treat "does a real user actually see this branded message
// instead of a blank/broken page during a real apps/api outage" as a
// real open question needing verification with proper browser tooling
// (or a real deployed environment) before relying on it, not a
// confirmed fact.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="wrap" style={{ paddingTop: 24, paddingBottom: 60 }}>
          <section>
            <div className="story-meta">Error</div>
            <h1 style={{ fontSize: 28, margin: "4px 0 12px" }}>Something went wrong</h1>
            <p>
              <button
                type="button"
                onClick={() => retry()}
                style={{ font: "inherit", padding: 0, border: 0, background: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                Try again
              </button>
              {" · "}
              <a href="/">Back to the homepage</a>
            </p>
          </section>
        </main>
      </body>
    </html>
  );
}
