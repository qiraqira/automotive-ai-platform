import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// One-shot backfill, 2026-09-16 — 4 PUBLISHED articles (out of only 112
// live) had zero HERO photo at all, found by media-health-check.ts.
// Sourced a real Commons photo for 3 of them, each downloaded and
// looked at directly before writing this script. The 4th (NeoVolta/SK
// On battery-cell supply deal) is deliberately skipped — the only
// Commons search hit was a 3D CAD rendering of a battery site, not a
// real photograph, and this project's own standing rule is real photos
// only, never a synthetic render passed off as one.
async function attach(articleSlug: string, sourceUrl: string, altText: string, artist: string, licenseSlug: string, licenseUrl: string) {
  const article = await prisma.article.findFirst({ where: { slug: articleSlug } });
  if (!article) throw new Error(`article ${articleSlug} not found`);
  const existing = await prisma.articleImage.findFirst({ where: { articleId: article.id, role: "HERO" } });
  if (existing) {
    console.log(`${articleSlug}: HERO image already present, left untouched.`);
    return;
  }

  const hosted = await selfHostImage(sourceUrl);
  const existingImage = await prisma.image.findUnique({ where: { sha256: hosted.sha256 } });
  const candidate: Pick<ImageCandidate, "provider" | "licenseSlug" | "licenseUrl" | "attributionRequired"> = {
    provider: "Wikimedia Commons",
    licenseSlug,
    licenseUrl,
    attributionRequired: true,
  };
  const imageId = existingImage
    ? existingImage.id
    : (
        await prisma.image.create({
          data: {
            originalUrl: hosted.localUrl,
            localStorageUrl: hosted.localUrl,
            sourceType: "CREATIVE_COMMONS",
            rightsStatus: rightsStatusFor(licenseSlug),
            author: artist,
            attribution: `${artist} — ${licenseSlug.toUpperCase()}, via Wikimedia Commons`,
            licenseId: await getOrCreateLicense(candidate as ImageCandidate),
            width: hosted.width,
            height: hosted.height,
            mimeType: "image/jpeg",
            sha256: hosted.sha256,
            generatedByAi: false,
          },
        })
      ).id;

  await prisma.articleImage.create({ data: { articleId: article.id, imageId, role: "HERO", position: 0, altText } });
  console.log(`${articleSlug}: hero image attached.`);
}

async function main() {
  await attach(
    "larte-design-transforms-bmw-x7-with-extensive-carbon-fiber-body-kit-sp1021",
    "https://commons.wikimedia.org/wiki/Special:FilePath/2025%20BMW%20X7%20xDrive40d%203.0%20M-Sport%20facelift%20front.jpg",
    "BMW X7 (G07, facelift) — base vehicle; not the Larte Design body kit",
    "LuvsMG481",
    "cc-by-sa-4.0",
    "https://creativecommons.org/licenses/by-sa/4.0",
  );

  await attach(
    "electric-vehicles-dominate-uk-car-market-with-30-share-rl589t",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Electric%20car%20charging%20points%20-%20geograph.org.uk%20-%207322507.jpg",
    "Electric vehicle charging points in the UK",
    "Philip Halling",
    "cc-by-sa-2.0",
    "https://creativecommons.org/licenses/by-sa/2.0",
  );

  await attach(
    "university-at-buffalo-deploys-eight-electric-buses-in-fleet-modernization-1u50io",
    "https://commons.wikimedia.org/wiki/Special:FilePath/New%20Flyer%20XE40%20Spokane%20Transit.jpg",
    "A 40-foot battery-electric transit bus (New Flyer XE40), generic photo — not UB's own fleet",
    "JTRamsey",
    "cc-by-sa-4.0",
    "https://creativecommons.org/licenses/by-sa/4.0",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
