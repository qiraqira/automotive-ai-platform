import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminAuthFile } from "./auth-file.js";

// Real automated a11y coverage (WCAG 2.0/2.1 A+AA, axe-core's default
// ruleset) — never checked at all before this. Runs against real pages
// with real seeded/ingested content, not empty fixtures, since a real
// page's actual DOM (dynamic story counts, real headings) is what a real
// reader's assistive tech encounters. Fails the build on any violation
// rather than just reporting one, since an a11y regression is a real
// regression, not a nice-to-have.

// Real gap found and fixed 2026-09-07: this list only ever covered 3 of
// the 6 real /about/* pages (corrections/editorial-policy/how-we-use-ai
// were missing entirely) — all three are real, indexable pages listed
// in sitemap.ts with their own real content and their own "renders its
// real heading" test in about.spec.ts, just never actually run through
// axe-core. Found by enumerating every real page.tsx in the app and
// diffing against this list, not by re-auditing pages already checked.
const PAGES = [
  "/",
  "/cars/bmw/3-series",
  "/topics/safety-recalls",
  "/search",
  "/search?q=BMW",
  "/about",
  "/about/contact",
  "/about/corrections",
  "/about/editorial-policy",
  "/about/how-we-use-ai",
  "/about/sources",
  "/admin/login",
];

for (const path of PAGES) {
  test(`${path} has no automatically-detectable a11y violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}

// Admin pages need a real session first (same seeded dev admin as
// admin.spec.ts). Real gap found and fixed 2026-09-07: this used to log
// in fresh via the real form in `beforeEach` for every admin page —
// harmless at 3-4 pages, but combined with admin.spec.ts's own per-test
// logins it silently exceeded apps/api's real login rate limit
// (10/15min) once this tick's `/admin/users` page pushed the count over
// the edge (caught by actually running the suite: login started 429ing
// and every downstream assertion failed with a misleading "still on
// /admin/login" error, not an a11y failure). Now loads the one real
// login session.auth.setup.ts performs, via Playwright's own
// storageState mechanism — see admin.spec.ts's header comment for the
// full rationale.
const ADMIN_PAGES = [
  "/admin",
  "/admin/stories",
  "/admin/alerts",
  "/admin/audit-log",
  "/admin/users",
  "/admin/cars",
  "/admin/redirects",
  "/admin/analytics",
];

test.describe("admin pages (authenticated)", () => {
  test.use({ storageState: adminAuthFile });

  for (const path of ADMIN_PAGES) {
    test(`${path} has no automatically-detectable a11y violations`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});
