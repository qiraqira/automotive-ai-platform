import { prisma } from "@automotive/database";
import type { CarVideoCategory } from "@automotive/database";

// One-shot CLI (`npm run add:car-video --workspace @automotive/worker --
// <brandSlug>/<modelSlug> <youtubeId> <category> "<title>"`). Small
// reusable helper for attaching a curated CarVideo row once a candidate
// has been found (real official-channel content, found this session via
// a YouTube RSS-feed + oembed verification pass — see
// docs/content-standards.md's "Video" section for the verification bar:
// confirm the real uploading channel before ever calling something
// OFFICIAL) — same idea as link-car-model-to-article.ts, just for the
// video side of the same audit.
async function main() {
  const [pair, youtubeId, category, title] = process.argv.slice(2);
  if (!pair || !youtubeId || !category || !title) {
    console.error('Usage: npm run add:car-video --workspace @automotive/worker -- <brandSlug>/<modelSlug> <youtubeId> <OFFICIAL|CRASH_TEST|REVIEW> "<title>"');
    process.exitCode = 1;
    return;
  }
  const [brandSlug, modelSlug] = pair.split("/");
  const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
  if (!brand) throw new Error(`brand "${brandSlug}" not found`);
  const carModel = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug! } } });
  if (!carModel) throw new Error(`car model "${pair}" not found`);

  const existing = await prisma.carVideo.findFirst({ where: { carModelId: carModel.id, youtubeId } });
  if (existing) {
    console.log(`${pair}: video ${youtubeId} already attached, skipping.`);
    return;
  }

  await prisma.carVideo.create({
    data: {
      carModelId: carModel.id,
      youtubeId,
      title,
      category: category as CarVideoCategory,
      sourceUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
    },
  });
  console.log(`${pair}: attached ${category} video "${title}" (${youtubeId})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
