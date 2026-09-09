import { test, expect } from "@playwright/test";
import { prisma } from "@automotive/database";

// apps/web/src/proxy.ts records a real pageview AnalyticsEvent via
// event.waitUntil — a server-to-server call that happens after the
// response is already sent, so it can't be observed through Playwright's
// browser-level network interception (that only sees the browser's own
// requests). Asserting directly against the real DB is the only way to
// actually prove this fires, same reasoning as apps/api's own
// SearchQuery-logging test.

test("visiting a real page records a real pageview AnalyticsEvent", async ({ page }) => {
  const path = "/about/corrections"; // a real, stable, low-traffic page
  const before = await prisma.analyticsEvent.count({ where: { path } });

  await page.goto(path);

  await expect
    .poll(async () => prisma.analyticsEvent.count({ where: { path } }), { timeout: 5000 })
    .toBeGreaterThan(before);
});

test("visiting a redirected path does not also record a pageview for the old path", async ({ page }) => {
  const oldPath = "/cars/bmw/3series";
  const before = await prisma.analyticsEvent.count({ where: { path: oldPath } });

  await page.goto(oldPath);
  await expect(page).toHaveURL(/\/cars\/bmw\/3-series$/);

  // Give any (incorrect) pageview call the same window the passing test
  // above proves is enough time for a real one to land, then assert it
  // genuinely didn't — proxy.ts returns before recordPageview() for a
  // redirect, so the old path must never accumulate events.
  await page.waitForTimeout(1000);
  const after = await prisma.analyticsEvent.count({ where: { path: oldPath } });
  expect(after).toBe(before);
});
