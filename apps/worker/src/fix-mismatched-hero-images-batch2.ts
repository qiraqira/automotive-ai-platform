import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// Second batch, same session (2026-09-16) — media-health-check.ts's
// altText/headline word-overlap heuristic surfaced 7 more real
// mismatches beyond the first 2 (fix-mismatched-hero-images.ts): a
// museum-exhibition hallway photo on a dual-clutch-transmission
// explainer, a Christchurch pier at sunset on a BMW 3 Series article, a
// Beatles vinyl record label on a Geely/Renault engine article, a WWI
// war-bonds poster on a Lexus GS F article, a dance-troupe stage photo
// on a Motor1 trivia-game article, a 19th-century engraved portrait on
// an EV-interest article, and a hand-drawn doodle on a 250k-mile-study
// article. Each replacement below was found via a real Commons search,
// downloaded, and looked at directly before writing this script.
async function replace(articleSlug: string, sourceUrl: string, altText: string, artist: string, licenseSlug: string, licenseUrl: string) {
  const article = await prisma.article.findFirst({ where: { slug: articleSlug } });
  if (!article) throw new Error(`article ${articleSlug} not found`);
  const heroLink = await prisma.articleImage.findFirst({ where: { articleId: article.id, role: "HERO" } });
  if (!heroLink) throw new Error(`no HERO image on ${articleSlug}`);

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

  await prisma.articleImage.update({ where: { id: heroLink.id }, data: { imageId, altText } });
  console.log(`${articleSlug}: hero image replaced.`);
}

async function main() {
  await replace(
    "dual-clutch-transmissions-offer-speed-at-a-cost-rul3yn",
    "https://commons.wikimedia.org/wiki/Special:FilePath/VW%20DSG%20transmission%20DTMB.jpg",
    "Cutaway of a dual-clutch (DSG) transmission",
    "Matti Blume",
    "cc-by-sa-3.0",
    "https://creativecommons.org/licenses/by-sa/3.0",
  );

  await replace(
    "bmw-3-series-receives-enhanced-six-cylinder-power-plant-oq6qvi",
    "https://commons.wikimedia.org/wiki/Special:FilePath/BMW%203%20SERIES%20SEDAN%20(G20)%20China.jpg",
    "BMW 3 Series Sedan (G20)",
    "Dinkun Chen",
    "cc-by-sa-4.0",
    "https://creativecommons.org/licenses/by-sa/4.0",
  );

  await replace(
    "geely-and-renault-develop-engine-built-for-deep-water-wading-7fx80z",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Land%20Rover%2090%20Wading.JPG",
    "A vehicle fording deep water, illustrating the wading challenge the new engine addresses",
    "MartinSpamer",
    "cc-by-sa-3.0",
    "https://creativecommons.org/licenses/by-sa/3.0",
  );

  await replace(
    "used-lexus-gs-f-offers-high-revving-v8-sedan-thrills-at-bargain-pricing-2328ad",
    "https://commons.wikimedia.org/wiki/Special:FilePath/2016%20Lexus%20GS-F%20Fujiweiss%20Frontalansicht.jpg",
    "Lexus GS F",
    "Kickaffe",
    "cc-by-sa-4.0",
    "https://creativecommons.org/licenses/by-sa/4.0",
  );

  await replace(
    "motor1-launches-head-to-head-trivia-game-for-car-enthusiasts-marf6x",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Lamborghini%20Infotainment%20.jpg",
    "A car's touchscreen infotainment display, generic photo",
    "Tabascogiuseppe1960",
    "cc-by-sa-4.0",
    "https://creativecommons.org/licenses/by-sa/4.0",
  );

  await replace(
    "growing-ev-interest-among-americans-driven-by-charging-infrastructure-po7xgy",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Electric%20vehicle%20charging%20stations%20in%20Stuttgart%201X7A6287.jpg",
    "Electric vehicle charging stations",
    "Alexander Migl",
    "cc-by-sa-4.0",
    "https://creativecommons.org/licenses/by-sa/4.0",
  );

  await replace(
    "study-identifies-vehicles-with-highest-odds-of-reaching-250-000-miles-atik68",
    "https://commons.wikimedia.org/wiki/Special:FilePath/SEAT%20Alhambra%20Mk1%20odometer.jpg",
    "A car odometer showing 200,000 miles",
    "Andy / Andrew Fogg",
    "cc-by-2.0",
    "https://creativecommons.org/licenses/by/2.0",
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
