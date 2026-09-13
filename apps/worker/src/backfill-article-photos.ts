import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// One-shot CLI entrypoint (`npm run backfill:article-photos --workspace
// @automotive/worker`). Two real bugs found live 2026-09-14 from the
// user's own read-through of the published site (their screenshots
// couldn't reach this session, but their text description matched a DB
// query exactly):
//
// 1. Three of this session's own COMPARISON articles (Corolla vs Civic,
//    RAV4 vs CR-V, Model 3 vs Model Y) were published with ZERO images
//    at all — this session verified their citation links after
//    publishing each one but never actually checked for image presence,
//    so the gap went unnoticed until the user found it by reading the
//    live pages. Fixed here by reusing each compared CarModel's own
//    already-self-hosted HERO CarModelImage (no new download needed —
//    same Image row, just a second ArticleImage pointing at it).
//
// 2. The pre-existing "BMW X5 vs Mercedes-Benz GLE" article (predates
//    this session) had 3 real X5 photos (hero + exterior gallery +
//    interior gallery) and only ONE Mercedes photo — an interior shot,
//    with no exterior GLE photo at all, visually reading as an article
//    mostly about the X5. Fixed by self-hosting a real GLE exterior
//    photo as a fourth gallery image.

interface ReuseJob {
  articleSlug: string;
  imageId: string;
  role: "HERO" | "GALLERY";
  position: number;
  altText: string;
}

const reuseJobs: ReuseJob[] = [
  {
    articleSlug: "toyota-corolla-vs-honda-civic-compared",
    imageId: "cmu04qz730012g2c9w37kxe0t", // Toyota Corolla HERO
    role: "HERO",
    position: 0,
    altText: "A silver 2024 Toyota Corolla LE sedan, twelfth generation",
  },
  {
    articleSlug: "toyota-corolla-vs-honda-civic-compared",
    imageId: "cmu04xhuc000y3hby9i09pf0t", // Honda Civic HERO
    role: "GALLERY",
    position: 1,
    altText: "A blue Honda Civic Sport sedan, eleventh generation",
  },
  {
    articleSlug: "toyota-rav4-vs-honda-cr-v-compared",
    imageId: "cmtwxika1002aea3a4358cmsm", // Toyota RAV4 HERO
    role: "HERO",
    position: 0,
    altText: "Toyota RAV4",
  },
  {
    articleSlug: "toyota-rav4-vs-honda-cr-v-compared",
    imageId: "cmu06eijc000wvi6r1p3ep9w8", // Honda CR-V HERO
    role: "GALLERY",
    position: 1,
    altText: "A dark grey 2023 Honda CR-V EX-L, sixth generation",
  },
  {
    articleSlug: "tesla-model-3-vs-model-y-compared",
    imageId: "cmu08h2m7000wyb5afn99lj63", // Tesla Model 3 HERO
    role: "HERO",
    position: 0,
    altText: "A white Tesla Model 3 (Highland refresh)",
  },
  {
    articleSlug: "tesla-model-3-vs-model-y-compared",
    imageId: "cmtsv3zvx0093q9z52w62lvae", // Tesla Model Y HERO
    role: "GALLERY",
    position: 1,
    altText: "Tesla Model Y",
  },
];

async function runReuseJobs(): Promise<void> {
  for (const job of reuseJobs) {
    const article = await prisma.article.findUnique({ where: { locale_slug: { locale: "en", slug: job.articleSlug } } });
    if (!article) {
      console.log(`Skipping ${job.articleSlug}: article not found.`);
      continue;
    }
    const existing = await prisma.articleImage.findFirst({ where: { articleId: article.id, role: job.role, position: job.position } });
    if (existing) {
      console.log(`${job.articleSlug} (${job.role}#${job.position}): already present, left untouched.`);
      continue;
    }
    await prisma.articleImage.create({
      data: { articleId: article.id, imageId: job.imageId, role: job.role, position: job.position, altText: job.altText },
    });
    console.log(`${job.articleSlug} (${job.role}#${job.position}): attached (reused existing self-hosted Image row).`);
  }
}

async function addGleExteriorPhoto(): Promise<void> {
  const article = await prisma.article.findUnique({ where: { locale_slug: { locale: "en", slug: "bmw-x5-vs-mercedes-benz-gle" } } });
  if (!article) {
    console.log("bmw-x5-vs-mercedes-benz-gle: article not found.");
    return;
  }
  const existing = await prisma.articleImage.findFirst({ where: { articleId: article.id, role: "GALLERY", position: 4 } });
  if (existing) {
    console.log("bmw-x5-vs-mercedes-benz-gle (GALLERY#4): already present, left untouched.");
    return;
  }

  // Wikimedia Commons, "2020 Mercedes-Benz GLE 350 4Matic front 6.16.19.jpg"
  // — viewed directly before use: a genuine W167 GLE, correct grille/
  // badge for this generation. CC BY-SA 4.0, attribution required. Self-
  // hosted here (this article's other 4 photos are still hotlinked from
  // thumb.wikimedia.org, predating this project's own "always self-host"
  // rule — a separate cleanup from this specific fix).
  const sourceUrl = "https://upload.wikimedia.org/wikipedia/commons/e/e9/2020_Mercedes-Benz_GLE_350_4Matic_front_6.16.19.jpg";
  const hosted = await selfHostImage(sourceUrl);
  const existingImage = await prisma.image.findUnique({ where: { sha256: hosted.sha256 } });

  const candidate: Pick<ImageCandidate, "provider" | "licenseSlug" | "licenseUrl" | "attributionRequired"> = {
    provider: "Wikimedia Commons",
    licenseSlug: "cc-by-sa-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
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
            rightsStatus: rightsStatusFor(candidate.licenseSlug),
            author: "Kevauto",
            attribution: "Kevauto — CC BY-SA 4.0, via Wikimedia Commons",
            licenseId: await getOrCreateLicense(candidate as ImageCandidate),
            width: hosted.width,
            height: hosted.height,
            mimeType: "image/jpeg",
            sha256: hosted.sha256,
            generatedByAi: false,
          },
        })
      ).id;

  await prisma.articleImage.create({
    data: { articleId: article.id, imageId, role: "GALLERY", position: 4, altText: "A white Mercedes-Benz GLE 350 4Matic, W167 generation, front three-quarter view" },
  });
  console.log("bmw-x5-vs-mercedes-benz-gle (GALLERY#4): attached real GLE exterior photo (self-hosted, human-verified).");
}

async function main() {
  await runReuseJobs();
  await addGleExteriorPhoto();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
