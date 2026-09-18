import { prisma } from "@automotive/database";

// One-shot CLI (`npm run delete:empty-car-model --workspace @automotive/worker
// -- <brandSlug>/<modelSlug> ...`). Cleans up the exact orphaned-stub shape
// auto-seed-catalog.ts can leave behind: it upserts the Brand+CarModel row
// BEFORE fetching the Wikipedia infobox, so a failed/retried fetch (wrong
// title, transient 429, etc.) can leave a CarModel with zero Generations,
// zero photos, zero facts — dead weight in brand pages/catalog listings.
// Safety: refuses to delete any model that actually has real data (a real
// generation), so this can never remove genuine catalog content by mistake.
async function main() {
  const pairs = process.argv.slice(2);
  if (pairs.length === 0) {
    console.error("Usage: npm run delete:empty-car-model --workspace @automotive/worker -- <brandSlug>/<modelSlug> ...");
    process.exitCode = 1;
    return;
  }
  for (const pair of pairs) {
    const [brandSlug, modelSlug] = pair.split("/");
    const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
    if (!brand) {
      console.log(`[skip] ${pair} — brand not found`);
      continue;
    }
    const carModel = await prisma.carModel.findUnique({
      where: { brandId_slug: { brandId: brand.id, slug: modelSlug! } },
      include: { generations: { select: { id: true } } },
    });
    if (!carModel) {
      console.log(`[skip] ${pair} — model not found`);
      continue;
    }
    if (carModel.generations.length > 0) {
      console.log(`[refuse] ${pair} — has ${carModel.generations.length} real generation(s), not deleting`);
      continue;
    }
    await prisma.carModel.delete({ where: { id: carModel.id } });
    console.log(`[deleted] ${pair} — was an empty stub (0 generations)`);
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
