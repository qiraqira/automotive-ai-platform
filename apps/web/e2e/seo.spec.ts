import { test, expect } from "@playwright/test";

// Locks in SEO-critical behavior that previously only had manual curl
// verification (per project memory) — no automated regression guard.
// Also covers a real gap found and fixed while writing this file: topic
// pages existed and were linked from the homepage but were never added to
// sitemap.xml (apps/api's new GET /v1/topics + apps/web/src/app/sitemap.ts).

test("sitemap.xml lists the homepage, the real seeded car, and every real topic", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("<loc>https://DOMAIN.COM</loc>");
  expect(body).toContain("<loc>https://DOMAIN.COM/cars/bmw/3-series</loc>");
  expect(body).toContain("<loc>https://DOMAIN.COM/topics/safety-recalls</loc>");
  expect(body).toContain("<loc>https://DOMAIN.COM/topics/electric-vehicles</loc>");
  expect(body).toContain("<loc>https://DOMAIN.COM/topics/market-business</loc>");
  expect(body).toContain("<loc>https://DOMAIN.COM/about</loc>");
  expect(body).toContain("<loc>https://DOMAIN.COM/about/sources</loc>");
  expect(body).toContain("<loc>https://DOMAIN.COM/about/contact</loc>");
});

test("robots.txt disallows /admin/ and points at the real sitemap", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("Disallow: /admin/");
  expect(body).toContain("Sitemap: https://DOMAIN.COM/sitemap.xml");
});

test("the real seeded redirect 301s the old car URL to the new one", async ({ request }) => {
  const res = await request.get("/cars/bmw/3series", { maxRedirects: 0 });
  expect(res.status()).toBe(301);
  expect(res.headers()["location"]).toBe("/cars/bmw/3-series");
});
