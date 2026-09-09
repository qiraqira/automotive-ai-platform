import { test as setup, expect } from "@playwright/test";
import { adminAuthFile } from "./auth-file.js";

// Real gap found and fixed 2026-09-07: this suite used to log in fresh
// (a real browser-driven form submission) at the top of nearly every
// admin-facing test, plus once per admin page in accessibility.spec.ts's
// beforeEach. That was already exactly at apps/api's real login rate
// limit (10 attempts/15min, deliberately tight — see app.ts) with the
// admin-page count this project had before this tick; adding this tick's
// `/admin/users` page and its own tests pushed the total over it for
// real (`toHaveURL(/\/admin$/)` started failing because login itself was
// silently 429ing) — caught by actually running the full suite, not
// assumed. Fixed with Playwright's own recommended pattern: log in for
// real exactly ONCE per suite run here, save the resulting session
// cookie to disk, and have every other admin test load it via
// `test.use({ storageState: adminAuthFile })` instead of resubmitting
// the login form. The real login flow itself is still fully exercised —
// just in one authoritative place instead of a dozen.

setup("authenticate as the real seeded dev admin", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("admin@dev.local");
  await page.getByLabel("Password").fill("dev-admin-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.context().storageState({ path: adminAuthFile });
});
