import { prisma } from "@automotive/database";

// Deterministic, zero-download gallery backfill for PUBLISHED comparison
// articles (`npm run backfill:comparison-gallery --workspace
// @automotive/worker`). Built 2026-09-18 straight off comparison-media-
// audit.ts's findings: several catalog CarModels already have plenty of
// real, human-verified CarModelImage rows (X5 has 4, Charger has 9,
// Elantra has 8, etc.) that were never reused as article GALLERY photos
// — same reuse pattern backfill-article-photos.ts already established
// ("no new download needed — same Image row, just a second ArticleImage
// pointing at it"), just generalized to run across every comparison
// article instead of a hardcoded one-off list. No fetch, no AI call, no
// new Image rows — this only adds ArticleImage join rows for photos the
// catalog has already vetted.
//
// Per article, per linked CarModel, tops each side up to TARGET_PER_SIDE
// gallery photos (skipping any CarModelImage whose underlying imageId is
// already attached to the article), capped by whatever that CarModel
// actually has — never invents a photo, and keeps both sides of a
// comparison balanced (adds min(available_A, available_B, target) extra
// photos to each side, not whichever side happens to have more).

const TARGET_PER_SIDE = 3;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== Comparison gallery reuse backfill ${dryRun ? "(DRY RUN)" : ""} ===\n`);

  const articles = await prisma.article.findMany({
    where: { status: "PUBLISHED", OR: [{ type: "COMPARISON" }, { contentPurpose: "COMPARISON" }] },
    select: {
      id: true,
      slug: true,
      headline: true,
      carModels: { select: { carModel: { select: { id: true, name: true, brand: { select: { name: true } } } } } },
      images: { select: { imageId: true, position: true } },
    },
  });

  let totalAdded = 0;

  for (const a of articles) {
    const cars = a.carModels.map((c) => c.carModel);
    if (cars.length !== 2) {
      console.log(`- "${a.slug}": skipped (${cars.length} linked car model(s), expected 2)`);
      continue;
    }

    const usedImageIds = new Set(a.images.map((i) => i.imageId));
    let nextPosition = a.images.reduce((max, i) => Math.max(max, i.position), -1) + 1;

    const perSideAvailable = await Promise.all(
      cars.map(async (c) => {
        const photos = await prisma.carModelImage.findMany({
          where: { carModelId: c.id },
          orderBy: [{ role: "asc" }, { position: "asc" }],
          select: { imageId: true, altText: true },
        });
        return photos.filter((p) => !usedImageIds.has(p.imageId));
      }),
    );

    const addPerSide = Math.min(TARGET_PER_SIDE, ...perSideAvailable.map((p) => p.length));
    if (addPerSide <= 0) {
      console.log(`- "${a.slug}": no new balanced photos available (side availability: ${perSideAvailable.map((p) => p.length).join("/")})`);
      continue;
    }

    console.log(`- "${a.slug}": adding ${addPerSide} photo(s) per side (${cars.map((c) => `${c.brand.name} ${c.name}`).join(" vs ")})`);
    for (let side = 0; side < 2; side++) {
      const car = cars[side]!;
      const toAdd = perSideAvailable[side]!.slice(0, addPerSide);
      for (const photo of toAdd) {
        console.log(`    + GALLERY imageId=${photo.imageId} (${car.brand.name} ${car.name}) altText="${photo.altText ?? `${car.brand.name} ${car.name}`}"`);
        if (!dryRun) {
          await prisma.articleImage.create({
            data: {
              articleId: a.id,
              imageId: photo.imageId,
              role: "GALLERY",
              position: nextPosition++,
              altText: photo.altText ?? `${car.brand.name} ${car.name}`,
            },
          });
        }
        totalAdded++;
      }
    }
  }

  console.log(`\n=== ${dryRun ? "Would add" : "Added"} ${totalAdded} ArticleImage row(s) across ${articles.length} article(s) ===`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
