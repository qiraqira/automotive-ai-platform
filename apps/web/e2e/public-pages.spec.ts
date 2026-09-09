import { test, expect } from "@playwright/test";

// Golden-path checks against real seeded data (packages/database/src/seed.ts)
// + real ingested Stories — not mocked responses. Assumes `npm run db:seed`
// has already been run against the DB the api webServer connects to, same
// assumption apps/api's own integration tests make.

test("homepage shows the real Latest feed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Latest" })).toBeVisible();
  await expect(page.locator(".story-item").first()).toBeVisible();
});

test("homepage shows real per-topic sections below Latest, each linking to its topic page", async ({ page }) => {
  await page.goto("/");
  // Real backfilled data (apps/worker/src/backfill-topics.ts): Electric
  // Vehicles has 50+ real classified stories, so its section must show
  // a "See all" link; Market & Business has only 4, so it must not.
  const evHeading = page.getByRole("heading", { name: "Electric Vehicles" });
  await expect(evHeading).toBeVisible();
  await expect(page.getByRole("link", { name: /See all \d+/ }).first()).toBeVisible();

  const marketSection = page.locator("section", { has: page.getByRole("heading", { name: "Market & Business" }) });
  await expect(marketSection.getByRole("link", { name: /See all/ })).toHaveCount(0);
});

test("a story's topic badge links to a working topic page", async ({ page }) => {
  await page.goto("/");
  const topicLink = page.locator('a[href^="/topics/"]').first();
  await expect(topicLink).toBeVisible();
  const href = await topicLink.getAttribute("href");
  await topicLink.click();
  await expect(page).toHaveURL(new RegExp(href!.replace(/[/]/g, "\\/") + "$"));
  await expect(page.getByRole("heading", { name: "Topic" })).toBeVisible();
});

test("real seeded car page renders trims and facts", async ({ page }) => {
  await page.goto("/cars/bmw/3-series");
  await expect(page.getByRole("heading", { name: "3 Series" })).toBeVisible();
  await expect(page.getByText("Facts")).toBeVisible();
  await expect(page.getByText(/330i|M340i|M3 Competition/).first()).toBeVisible();

  // Real gap found and fixed 2026-09-07: packages/utils's real,
  // unit-tested locale-aware unit formatting (formatPowerKw()) had zero
  // callers anywhere — this page used to show both hp AND kW
  // simultaneously with hardcoded literal suffixes instead of the one
  // real value the spec's own worked example calls for. Locks in the
  // real seeded B48 engine (190 kW / 255 hp — the real data doesn't
  // change, only the way it's rendered) now shows exactly one value.
  await expect(page.getByText("255 hp")).toBeVisible();
  await expect(page.getByText("190 kW")).not.toBeVisible();

  // Real gap found and fixed 2026-09-07: Brand.country (real seed data,
  // BMW = "DE") had a real caller nowhere in apps/web despite the API
  // already returning it — locks in the real formatted country name
  // (packages/utils's new formatCountryName(), Intl.DisplayNames-backed),
  // not the raw "DE" code.
  await expect(page.getByText("Germany")).toBeVisible();
});

test("a nonexistent car 404s with the real not-found page", async ({ page }) => {
  const res = await page.goto("/cars/bmw/not-a-real-model");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("a nonexistent topic 404s", async ({ page }) => {
  const res = await page.goto("/topics/not-a-real-topic");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Page not found")).toBeVisible();
});

test("search finds the real seeded BMW 3 Series car", async ({ page }) => {
  await page.goto("/search?q=BMW");
  await expect(page.getByRole("link", { name: "3 Series" })).toBeVisible();
});
