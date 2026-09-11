import { prisma } from "@automotive/database";
import { detectBrand, searchBrandLogo, hashRemoteImage, getOrCreateLicense } from "./fetch-images.js";

// One-shot CLI entrypoint (`npm run recover:hero-images --workspace apps/worker`).
//
// Real, self-inflicted damage found and fixed live 2026-09-11, same
// tick: the first (buggy) run of reverify-hero-images.ts mistook
// several articles' already-honest brand-logo fallbacks for real
// photos, deleted them, and — when a fresh logo search also failed
// (Denza has no standalone Commons logo file) — left some PUBLISHED,
// reader-visible articles with literally no hero image at all. That
// script is fixed now, but the already-deleted rows need restoring.
// This is a narrower, standalone recovery pass: for every PUBLISHED
// article with zero HERO image, try the same brand-logo fallback one
// more time (now correctly excluded from ever being re-deleted by the
// fixed reverify script's own logo-filename check).
async function main() {
  // `type: "NEWS"` only — the hand-authored GUIDE/COMPARISON/ANALYSIS
  // articles (seed-real-articles.ts) never had a hero image at all
  // (a real, separate, pre-existing gap, not something this recovery
  // pass caused) and deserve a real CarModel photo, not a generic brand
  // logo — handled separately, deliberately, not by this blanket pass.
  const imageless = await prisma.article.findMany({
    where: { status: "PUBLISHED", type: "NEWS", images: { none: { role: "HERO" } } },
    select: { id: true, headline: true },
  });
  console.log(`Found ${imageless.length} PUBLISHED article(s) with zero hero image.`);

  const PARENT_BRAND: Record<string, string> = { Denza: "BYD" };

  let recovered = 0;
  let noFallback = 0;
  for (const article of imageless) {
    const brand = detectBrand(article.headline);
    let logoCandidate = brand ? await searchBrandLogo(brand) : null;
    let logoBrandLabel = brand;
    if (!logoCandidate && brand && PARENT_BRAND[brand]) {
      logoCandidate = await searchBrandLogo(PARENT_BRAND[brand]);
      logoBrandLabel = PARENT_BRAND[brand];
    }
    if (!logoCandidate) {
      noFallback++;
      console.log(`- no fallback for "${article.headline}" (brand detected: ${brand ?? "none"})`);
      continue;
    }

    const { sha256 } = await hashRemoteImage(logoCandidate.thumbUrl);
    const existingImage = await prisma.image.findUnique({ where: { sha256 } });
    const imageId = existingImage
      ? existingImage.id
      : (
          await prisma.image.create({
            data: {
              originalUrl: logoCandidate.thumbUrl,
              sourceType: "CREATIVE_COMMONS",
              rightsStatus: "EDITORIAL_ONLY",
              author: logoCandidate.artist,
              attribution: `${logoCandidate.artist} — ${logoCandidate.licenseShortName}, via ${logoCandidate.provider}`,
              licenseId: await getOrCreateLicense(logoCandidate),
              width: logoCandidate.width,
              height: logoCandidate.height,
              mimeType: logoCandidate.mime,
              sha256,
              generatedByAi: false,
            },
          })
        ).id;
    await prisma.articleImage.create({
      data: { articleId: article.id, imageId, role: "HERO", position: 0, altText: `${logoBrandLabel} logo` },
    });
    recovered++;
    console.log(`✓ recovered "${article.headline}" with the real ${logoBrandLabel} logo`);
  }

  console.log(`Done: ${recovered} recovered with a brand logo, ${noFallback} still have no image (no brand detectable in the headline).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
