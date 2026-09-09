import { test, expect } from "@playwright/test";

// Smoke coverage for the spec §67-69 credibility page set — static
// content, but real pages that were never locked in by any automated test
// before (only ever curl-checked manually per project memory).

const PAGES: { path: string; heading: string }[] = [
  { path: "/about", heading: "About" },
  { path: "/about/contact", heading: "Contact" },
  { path: "/about/corrections", heading: "Corrections" },
  { path: "/about/editorial-policy", heading: "Editorial Policy" },
  { path: "/about/how-we-use-ai", heading: "How we use AI" },
  { path: "/about/sources", heading: "Sources" },
];

for (const { path, heading } of PAGES) {
  test(`${path} renders its real heading`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  });
}

test("/about/sources lists the real seeded sources with trust scores", async ({ page }) => {
  await page.goto("/about/sources");
  await expect(page.getByText(/Electrek|InsideEVs|Motor1/).first()).toBeVisible();
});
