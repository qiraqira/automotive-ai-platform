import { prisma } from "@automotive/database";

// One-shot CLI (`npm run mark:catalog-reviewed --workspace
// @automotive/worker -- <brandSlug>/<modelSlug> [<brandSlug>/<modelSlug> ...]`).
// Sets CarModel.catalogReviewedAt (added 2026-09-15 — see its own schema
// comment) for models that have actually been taken to the X5's own
// standard of completeness: real, individually verified generations,
// hand-picked photos, no duplicate/overlapping data. This is the ONLY
// way a model becomes visible again (brand page Models section, GET
// /v1/cars, GET /v1/featured-cars, car page indexing) after the
// >=2-generations count gate was dropped for being too permissive.

async function main() {
  const pairs = process.argv.slice(2);
  if (pairs.length === 0) {
    console.error("Usage: npm run mark:catalog-reviewed --workspace @automotive/worker -- <brandSlug>/<modelSlug> ...");
    process.exitCode = 1;
    return;
  }
  for (const pair of pairs) {
    const [brandSlug, modelSlug] = pair.split("/");
    if (!brandSlug || !modelSlug) {
      console.log(`[skip] "${pair}" — expected <brandSlug>/<modelSlug>`);
      continue;
    }
    const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
    if (!brand) {
      console.log(`[skip] ${pair} — brand not found`);
      continue;
    }
    const carModel = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug } } });
    if (!carModel) {
      console.log(`[skip] ${pair} — model not found`);
      continue;
    }
    await prisma.carModel.update({ where: { id: carModel.id }, data: { catalogReviewedAt: new Date() } });
    console.log(`[ok] ${brand.name} ${carModel.name} marked reviewed.`);
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
