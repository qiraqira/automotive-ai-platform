import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// One-shot fix, 2026-09-16 — a site-wide media sweep found two live
// articles showing a completely unrelated hero image: a WWII propaganda
// poster (NARA archive scan) on a tire-repair-service article, and an
// Xbox One logo on a solar-panel-recycling article. Root cause:
// seed-real-cars.ts's old direct `originalUrl: candidate.thumbUrl`
// write also skipped verifyImageMatch on the very first bulk pass for
// some non-car NEWS articles' hero images (fixed for the car-photo path
// in this same commit). Replacement photos below were found via a real
// Commons search, downloaded, and looked at directly before writing this
// script — not another automated match.
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
    "discount-tire-offers-free-repair-service-for-punctured-tires-dwuhew",
    "https://commons.wikimedia.org/wiki/Special:FilePath/PunctureRepairWorkshop.JPG",
    "Roadside tire puncture repair shop",
    "Arne Hückelheim",
    "cc-by-sa-3.0",
    "https://creativecommons.org/licenses/by-sa/3.0",
  );

  await replace(
    "texas-solar-recycling-plant-targets-high-recovery-rates-04gdtj",
    "https://commons.wikimedia.org/wiki/Special:FilePath/Solar%20Panels.jpg",
    "Solar panels",
    "Fernando Tomás",
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
