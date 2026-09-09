"use client";

// Real gap found and fixed 2026-09-07: apps/web has a custom, themed 404
// page (not-found.tsx, rendered inside the normal root layout, keeping
// the site header/nav/JSON-LD) but no matching error.tsx — so a real
// Server Component failure (e.g. apps/api being briefly unreachable, a
// real operational scenario, not contrived) fell all the way through to
// Next's own BUILT-IN global-error fallback (confirmed via the real
// compiled source at node_modules/next/dist/client/components/builtin/
// global-error.js, and live via curl with a real production `next build
// && next start` against a deliberately-killed apps/api): a reasonably
// designed but entirely unbranded UI that replaces the WHOLE document
// (`<html id="__next_error__">`, its own separate head/body — Next's own
// bundled docs, node_modules/next/dist/docs/01-app/01-getting-started/
// 10-error-handling.md, confirm this is by design: "Global error UI...
// is replacing the root layout"), discarding this site's own
// header/nav/JSON-LD entirely. A route-level error.tsx (this file)
// catches the same failure one level lower, inside the root layout,
// matching the design consistency already invested in not-found.tsx.
//
// Must be a Client Component — Next's error.tsx convention requires it
// (confirmed against the same bundled doc, since this project's installed
// Next.js version has real breaking API changes from training data per
// apps/web/AGENTS.md's own warning) — the one deliberate exception to
// this project's otherwise near-zero-client-JS pages, activating only on
// an actual error, never a normal page load. `retry()` re-renders the
// failed segment without a full page reload; the runtime also still
// passes an equivalent `reset` prop (confirmed by reading
// error-boundary.js directly), but `retry` is what this version's own
// docs document, so that's the one to use.
//
// Re-verified 2026-09-07 (same day, later pass) and found this file
// does NOT currently catch anything in this exact Next.js version
// (16.3.4) — confirmed with a minimal, dependency-free diagnostic page
// (`throw new Error(...)` directly, nothing to do with apps/api) in
// both `next start` and `next dev`: `__next_error__` rendered every
// time, never this component. Per the bundled reference doc's own
// "Version History" (node_modules/next/dist/docs/01-app/03-api-
// reference/03-file-conventions/error.md): the `retry` prop only
// became stable in v16.3.0, four patch releases before this project's
// installed v16.3.4 — plausibly a real, version-specific regression in
// a very recently stabilized area of the framework, not fixable from
// application code. `global-error.tsx` (added the same pass) is the
// next-best documented mechanism, but its own effect couldn't be
// conclusively verified either in this environment — see that file's
// own comment for why. Kept this file in place rather than deleting
// it: it's genuinely spec-compliant per the docs, costs nothing to
// keep, and would automatically take priority over `global-error.tsx`
// (errors bubble to the *nearest* boundary, and this file's better
// integration — inside the real root layout, keeping header/nav/
// JSON-LD — wins when both would apply) the moment a future Next.js
// patch fixes whatever this version's real bug is.
//
// Re-verified again 2026-09-08 (a real, unplanned apps/api outage during
// an unrelated investigation, not a repeat of the above): fetched the
// real raw SSR HTML bytes via curl against a real production `next
// start` with apps/api genuinely killed (not `next dev` — dev mode's own
// error overlay isn't representative). Confirms and sharpens the "not
// fixable from application code" conclusion above with a fact that
// wasn't nailed down before: the initial response body contains
// literally zero visible error text anywhere — no "Something went
// wrong", no digest, nothing a user reads — only a serialized RSC
// payload referencing this component (`$3`) for the client to render
// after hydration, plus a bare `{"digest":"..."}` (production's own
// intentional error-message redaction, expected and correct on its
// own). A real visitor whose JS fails or is slow to hydrate during a
// real apps/api outage sees a functionally blank main content area
// (site header still renders — that's the root layout, unaffected)
// until/unless hydration completes — still genuinely unverified due to
// this environment's own pre-existing browser-tooling limitation
// (cannot reach localhost at all), not newly introduced by this pass.
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
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
  );
}
