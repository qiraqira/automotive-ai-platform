import { prisma } from "@automotive/database";
import { detectBrand, searchBrandLogo, hashRemoteImage, getOrCreateLicense } from "./fetch-images.js";
import { verifyImageMatch } from "./verify-image.js";

// One-shot CLI entrypoint (`npm run reverify:hero-images --workspace apps/worker`).
//
// Real, live bug found 2026-09-11 (user caught it directly, live on the
// site): the "byd-denza-n8-luxury-suv..." article was published with a
// BYD Sealion 6 photo as its hero image — a real, different model from
// the same brand, not the Denza N8 the article is actually about.
// Traced via the real AIJob log: the exact same candidate photo was
// correctly REJECTED for a differently-worded context ("BYD's new
// Defender-like SUV breaks cover") but wrongly ACCEPTED for a more
// generic one ("BYD's new luxury electric SUV has a range of over
// 1,000 km") — the vision check's own "low" image detail setting and
// looser prompt wording let a same-brand-different-model photo through
// when the context wasn't visually distinctive. verify-image.ts fixed
// going forward (now "high" detail, explicit same-brand-different-model
// rejection rule) — this script re-runs that stricter check against
// every ALREADY-PUBLISHED real (non-AI, non-logo) hero image already on
// the site, since the old, weaker check may have let others through too
// and nothing before this ever re-checked an image after it was first
// accepted.
//
// Deliberately narrower than replace-ai-images.ts: that script targets
// AI_GENERATED images (replace with something real); this one targets
// images that already claim to be a REAL photo (CREATIVE_COMMONS,
// non-EDITORIAL_ONLY — a logo fallback is already honest about not
// being a photo of the specific car, so it doesn't need re-verification
// the same way) and checks whether that claim actually held up under a
// stricter check. A rejected image is removed and replaced with the
// brand-logo fallback (never left silently blank, never guessed at with
// another photo) — the same "never worse than before" posture
// replace-ai-images.ts already established.
const BATCH_SIZE = Number(process.env.REVERIFY_HERO_IMAGES_BATCH_SIZE ?? 30);

async function main() {
  const candidates = await prisma.articleImage.findMany({
    where: {
      role: "HERO",
      image: { sourceType: "CREATIVE_COMMONS", rightsStatus: { not: "EDITORIAL_ONLY" }, generatedByAi: false },
      article: { status: "PUBLISHED" },
    },
    take: BATCH_SIZE,
    select: {
      id: true,
      articleId: true,
      image: { select: { id: true, originalUrl: true } },
      article: { select: { headline: true, story: { select: { title: true } } } },
    },
    orderBy: { id: "asc" },
  });

  console.log(`Found ${candidates.length} real (non-AI, non-logo) hero image(s) to re-verify (batch size ${BATCH_SIZE}).`);

  let confirmed = 0;
  let replacedWithLogo = 0;
  let removedNoFallback = 0;
  for (const link of candidates) {
    const context = link.article.story?.title ?? link.article.headline;
    const stillMatches = await verifyImageMatch(link.image.originalUrl, context);
    if (stillMatches) {
      confirmed++;
      continue;
    }

    console.log(`✗ re-verification now rejects "${link.article.headline}" — ${link.image.originalUrl}`);
    await prisma.articleImage.delete({ where: { id: link.id } });

    const brand = detectBrand(link.article.headline);
    const logoCandidate = brand ? await searchBrandLogo(brand) : null;
    if (!logoCandidate) {
      removedNoFallback++;
      console.log(`  removed, no brand-logo fallback available (brand detected: ${brand ?? "none"})`);
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
      data: { articleId: link.articleId, imageId, role: "HERO", position: 0, altText: `${brand} logo` },
    });
    replacedWithLogo++;
    console.log(`  replaced with the real ${brand} brand logo (honest fallback, not a guessed photo)`);
  }

  console.log(`Done: ${confirmed} confirmed still accurate, ${replacedWithLogo} replaced with a brand logo, ${removedNoFallback} removed with no fallback available.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
