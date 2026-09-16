import { existsSync } from "node:fs";
import path from "node:path";
import { prisma } from "@automotive/database";

// Deterministic, no-token-cost catalog sweep (`npm run media:health-check
// --workspace @automotive/worker`) — built 2026-09-16 after a manual DB
// sweep found three real, live problems by hand: 15 CarModels with zero
// HERO photo (3 of them Land Rover), 85 old NEWS articles with zero HERO
// photo (all from before the image pipeline existed, 2026-09-08/09), and
// 2 published articles showing a completely unrelated image (a WWII
// propaganda poster, an Xbox logo) because an early ingestion path never
// self-hosted or verified its match. This script automates all three
// checks so they don't need another manual SQL sweep next time. No AI
// calls: liveness is a file-exists/HTTP check, and the "suspicious
// image" pass is a plain word-overlap heuristic between an image's own
// altText and the headline/model it's attached to — crude, but it does
// catch exactly the two real mismatches found by hand (their altText was
// literally the *other* subject's file description, e.g. "Xbox One logo
// wordmark" on a solar-recycling article, with zero word overlap at all).
const UPLOAD_DIR = "/repo/uploads";
const USER_AGENT = "AutomotiveAIPlatform/1.0 (https://autonewsfeed.com; contact via site)";

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "with", "vs", "vs.",
  "compared", "review", "news", "explained", "is", "are", "at", "by", "new", "2024",
  "2025", "2026", "photo", "image", "file", "front", "rear", "side",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

function overlaps(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return true; // nothing meaningful to compare, don't flag
  for (const w of ta) if (tb.has(w)) return true;
  return false;
}

async function checkImageLive(originalUrl: string): Promise<boolean> {
  if (originalUrl.startsWith("/uploads/")) {
    return existsSync(path.join(UPLOAD_DIR, originalUrl.replace("/uploads/", "")));
  }
  try {
    const res = await fetch(originalUrl, { method: "HEAD", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": USER_AGENT } });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log("=== Media health check ===\n");

  // 1. Car models with zero HERO photo.
  const models = await prisma.carModel.findMany({
    include: { brand: true, images: { where: { role: "HERO" } } },
  });
  const noPhoto = models.filter((m) => m.images.length === 0);
  console.log(`Car models with zero HERO photo: ${noPhoto.length} / ${models.length}`);
  for (const m of noPhoto) console.log(`  - ${m.brand.slug}/${m.slug}`);

  // 2. Articles with zero HERO photo — broken out by status, added
  // 2026-09-16: the first version of this check lumped all 431 articles
  // together, which made a DRAFT-only backlog (never shown to a real
  // reader) look like a live-site problem. PUBLISHED is the number that
  // actually matters for urgency.
  const articles = await prisma.article.findMany({
    select: { id: true, slug: true, type: true, status: true, publishedAt: true, images: { where: { role: "HERO" }, select: { id: true } } },
  });
  const articlesNoPhoto = articles.filter((a) => a.images.length === 0);
  const publishedNoPhoto = articlesNoPhoto.filter((a) => a.status === "PUBLISHED");
  console.log(`\nArticles with zero HERO photo: ${articlesNoPhoto.length} / ${articles.length} (of which PUBLISHED: ${publishedNoPhoto.length})`);
  for (const a of publishedNoPhoto) console.log(`  PUBLISHED - ${a.slug}`);
  const oldest = articlesNoPhoto.reduce((min, a) => (a.publishedAt && (!min || a.publishedAt < min) ? a.publishedAt : min), null as Date | null);
  const newest = articlesNoPhoto.reduce((max, a) => (a.publishedAt && (!max || a.publishedAt > max) ? a.publishedAt : max), null as Date | null);
  if (oldest && newest) console.log(`  date range: ${oldest.toISOString().slice(0, 10)} to ${newest.toISOString().slice(0, 10)}`);

  // 3. Broken image URLs.
  const images = await prisma.image.findMany({ select: { id: true, originalUrl: true } });
  console.log(`\nChecking liveness of ${images.length} images...`);
  const broken: string[] = [];
  for (const img of images) {
    const ok = await checkImageLive(img.originalUrl);
    if (!ok) broken.push(`${img.id} ${img.originalUrl}`);
  }
  console.log(`Broken/unreachable images: ${broken.length}`);
  for (const b of broken) console.log(`  - ${b}`);

  // 4. Suspicious altText/subject mismatches — also split by status
  // (same 2026-09-16 fix as check #2, same reasoning).
  const articleImages = await prisma.articleImage.findMany({
    select: { altText: true, article: { select: { slug: true, headline: true, status: true } } },
    where: { role: "HERO" },
  });
  const carImages = await prisma.carModelImage.findMany({
    select: { altText: true, carModel: { select: { slug: true, name: true, brand: { select: { name: true } } } } },
    where: { role: "HERO" },
  });
  const suspiciousArticles = articleImages.filter((ai) => ai.altText && !overlaps(ai.altText, ai.article.headline));
  const suspiciousCars = carImages.filter((ci) => ci.altText && !overlaps(ci.altText, `${ci.carModel.brand.name} ${ci.carModel.name}`));
  const suspiciousPublished = suspiciousArticles.filter((s) => s.article.status === "PUBLISHED");
  console.log(`\nSuspicious article images (altText doesn't overlap headline): ${suspiciousArticles.length} (of which PUBLISHED: ${suspiciousPublished.length})`);
  for (const s of suspiciousArticles) console.log(`  [${s.article.status}] "${s.article.headline}" <- altText: "${s.altText}"`);
  console.log(`\nSuspicious car photos (altText doesn't overlap model name): ${suspiciousCars.length}`);
  for (const s of suspiciousCars) console.log(`  - ${s.carModel.brand.name} ${s.carModel.name} <- altText: "${s.altText}"`);

  console.log("\n=== Done ===");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
