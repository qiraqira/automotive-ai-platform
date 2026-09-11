import { prisma } from "@automotive/database";
import {
  searchCommonsImage,
  hashRemoteImage,
  rightsStatusFor,
  getOrCreateLicense,
} from "./fetch-images.js";
import { verifyImageMatch } from "./verify-image.js";

// One-off, hand-run script (2026-09-11) building the real photo gallery
// for the BMW X5 vs GLE comparison rebuild — the user's own explicit
// request: "Ищем туда официальные фотографии и добавляем их много и
// одной и другой машины" (find official photos and add many of both
// cars). Not a permanent pipeline stage — this searches several
// deliberately distinct queries per car (front/rear/interior/side) so
// each one's own top Commons match is a genuinely different photo,
// rather than one query returning the same single image repeatedly.
// Every candidate still goes through the same real vision-verify gate
// as attachHeroImage() (now fail-closed, see verify-image.ts's own
// history) — an unverified or duplicate candidate is skipped, never
// forced in just to hit a target count.

const ARTICLE_ID = "cmtwtbvq90000w2sxd0vkf9x3";

interface GallerySpec {
  context: string; // what the vision check judges the photo against
  queries: string[]; // tried in order until one verifies
}

const CARS: GallerySpec[] = [
  { context: "BMW X5 (G05), front three-quarter view", queries: ["BMW X5 G05 front"] },
  { context: "BMW X5 (G05), rear view", queries: ["BMW X5 G05 rear"] },
  { context: "BMW X5 (G05), interior dashboard", queries: ["BMW X5 G05 interior"] },
  { context: "Mercedes-Benz GLE (W167), front three-quarter view", queries: ["Mercedes-Benz GLE W167 front"] },
  { context: "Mercedes-Benz GLE (W167), rear view", queries: ["Mercedes-Benz GLE W167 rear"] },
  { context: "Mercedes-Benz GLE (W167), interior dashboard", queries: ["Mercedes-Benz GLE W167 interior"] },
];

async function main() {
  const existing = await prisma.articleImage.findMany({
    where: { articleId: ARTICLE_ID, role: "GALLERY" },
    select: { image: { select: { sha256: true } } },
  });
  const seenHashes = new Set(existing.map((e) => e.image.sha256));
  let position = 1; // 0 is the existing HERO

  for (const spec of CARS) {
    let attached = false;
    for (const query of spec.queries) {
      const candidate = await searchCommonsImage(query);
      if (!candidate) {
        console.log(`- no Commons candidate for "${query}"`);
        continue;
      }
      const { sha256 } = await hashRemoteImage(candidate.thumbUrl);
      if (seenHashes.has(sha256)) {
        console.log(`- "${query}" found a duplicate of an already-attached photo, skipping`);
        continue;
      }
      const verified = await verifyImageMatch(candidate.thumbUrl, spec.context);
      if (!verified) {
        console.log(`- rejected candidate for "${spec.context}": ${candidate.thumbUrl}`);
        continue;
      }

      const existingImage = await prisma.image.findUnique({ where: { sha256 } });
      const imageId = existingImage
        ? existingImage.id
        : (
            await prisma.image.create({
              data: {
                originalUrl: candidate.thumbUrl,
                sourceType: "CREATIVE_COMMONS",
                rightsStatus: rightsStatusFor(candidate.licenseSlug),
                author: candidate.artist,
                attribution: `${candidate.artist} — ${candidate.licenseShortName}, via ${candidate.provider}`,
                licenseId: await getOrCreateLicense(candidate),
                width: candidate.width,
                height: candidate.height,
                mimeType: candidate.mime,
                sha256,
                generatedByAi: false,
              },
            })
          ).id;

      await prisma.articleImage.create({
        data: {
          articleId: ARTICLE_ID,
          imageId,
          role: "GALLERY",
          position: position++,
          altText: candidate.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
        },
      });
      seenHashes.add(sha256);
      attached = true;
      console.log(`✓ attached gallery photo for "${spec.context}"`);
      break;
    }
    if (!attached) console.log(`- no verified real photo found for "${spec.context}", skipping (never forcing a guess)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
