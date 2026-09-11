import { prisma } from "@automotive/database";
import {
  IMAGE_PROVIDERS,
  buildSearchQueries,
  hashRemoteImage,
  rightsStatusFor,
  getOrCreateLicense,
} from "./fetch-images.js";
import { verifyImageMatch } from "./verify-image.js";

// Real user request (2026-09-11): 78 of 142 published NEWS articles
// (55%) currently show a brand-logo fallback instead of a real photo —
// most of these were logo'd back when this pipeline's hero-image search
// was weaker (narrower queries, `detail: "low"` vision checks — see
// verify-image.ts's own history). Re-running the same real search+
// verify loop attachHeroImage() uses can genuinely do better today.
// Deliberately does NOT call attachHeroImage() itself: that function's
// own logo-fallback tail would happily re-attach ANOTHER logo (a
// harmless but wasteful DB write) whenever no real photo is found, with
// no way to tell from its `boolean` return whether the result was an
// upgrade or a no-op. This duplicates just its search+verify loop,
// stopping short of the fallback, so the DB is only ever touched when a
// real improvement is actually found — an article that stays logo'd
// today is left exactly as it was.
async function findRealPhoto(searchTexts: string[]) {
  const context = searchTexts[0] ?? "";
  for (const query of buildSearchQueries(searchTexts)) {
    for (const searchProvider of IMAGE_PROVIDERS) {
      const candidate = await searchProvider(query);
      if (!candidate) continue;
      const verified = await verifyImageMatch(candidate.thumbUrl, context);
      if (verified) return candidate;
    }
  }
  return null;
}

async function main() {
  const candidates = await prisma.article.findMany({
    where: {
      status: "PUBLISHED",
      type: { in: ["NEWS", "BREAKING_NEWS"] },
      images: { some: { role: "HERO" } },
    },
    select: {
      id: true,
      headline: true,
      images: {
        where: { role: "HERO" },
        select: { id: true, image: { select: { id: true, originalUrl: true, rightsStatus: true } } },
        take: 1,
      },
    },
  });

  const logoArticles = candidates.filter((a) => {
    const img = a.images[0]?.image;
    if (!img) return false;
    return img.rightsStatus === "EDITORIAL_ONLY" || img.originalUrl.toLowerCase().includes("logo");
  });

  console.log(`Found ${logoArticles.length} logo-fallback article(s) out of ${candidates.length} with a hero image.`);

  let upgraded = 0;
  for (const article of logoArticles) {
    try {
      const found = await findRealPhoto([article.headline]);
      if (!found) {
        console.log(`- no real photo found for "${article.headline}", leaving logo in place`);
        continue;
      }

      const { sha256 } = await hashRemoteImage(found.thumbUrl);
      const existingImage = await prisma.image.findUnique({ where: { sha256 } });
      const imageId = existingImage
        ? existingImage.id
        : (
            await prisma.image.create({
              data: {
                originalUrl: found.thumbUrl,
                sourceType: "CREATIVE_COMMONS",
                rightsStatus: rightsStatusFor(found.licenseSlug),
                author: found.artist,
                attribution: `${found.artist} — ${found.licenseShortName}, via ${found.provider}`,
                licenseId: await getOrCreateLicense(found),
                width: found.width,
                height: found.height,
                mimeType: found.mime,
                sha256,
                generatedByAi: false,
              },
            })
          ).id;

      await prisma.articleImage.deleteMany({ where: { articleId: article.id, role: "HERO" } });
      await prisma.articleImage.create({
        data: { articleId: article.id, imageId, role: "HERO", position: 0, altText: found.title.replace(/^File:/, "").replace(/\.\w+$/, "") },
      });
      upgraded++;
      console.log(`✓ upgraded "${article.headline}" to a real photo`);
    } catch (err) {
      console.error(`- "${article.headline}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`Done: ${upgraded}/${logoArticles.length} upgraded to a real photo.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
