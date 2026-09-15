import { prisma } from "@automotive/database";

// One-off: found live reviewing the latest generation-discovery sweep's
// output — Honda Accord, Mercedes-Benz GLA and Toyota Highlander each
// still had their original "Overview" placeholder generation (with real
// trims/photos already attached from an EARLIER session, before this
// one) sitting alongside the newly-discovered real generation history.
// lib/apply-generations.ts's own delete-if-stranded check correctly
// refused to delete "Overview" since it wasn't empty — the fix is to
// merge its real data onto the actual current generation first.

const targets = ["honda/accord", "mercedes-benz/gla", "toyota/highlander"];

async function main() {
  for (const target of targets) {
    const [brandSlug, modelSlug] = target.split("/");
    const brand = await prisma.brand.findUnique({ where: { slug: brandSlug! } });
    const carModel = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand!.id, slug: modelSlug! } } });
    const overview = await prisma.generation.findFirst({ where: { carModelId: carModel!.id, slug: "overview" } });
    if (!overview) continue;
    const current = await prisma.generation.findFirst({
      where: { carModelId: carModel!.id, slug: { not: "overview" } },
      orderBy: { startYear: "desc" },
    });
    if (!current) continue;

    const photos = await prisma.carModelImage.updateMany({ where: { generationId: overview.id }, data: { generationId: current.id } });

    const overviewTrims = await prisma.trim.findMany({ where: { generationId: overview.id } });
    let trimsMoved = 0;
    let trimsDropped = 0;
    for (const trim of overviewTrims) {
      const collision = await prisma.trim.findUnique({ where: { generationId_slug: { generationId: current.id, slug: trim.slug } } });
      if (collision) {
        await prisma.engine.deleteMany({ where: { trimId: trim.id } });
        await prisma.trim.delete({ where: { id: trim.id } });
        trimsDropped++;
      } else {
        await prisma.trim.update({ where: { id: trim.id }, data: { generationId: current.id } });
        trimsMoved++;
      }
    }
    await prisma.generation.delete({ where: { id: overview.id } });
    console.log(`[ok] ${target}: moved ${photos.count} photo(s), ${trimsMoved} trim(s) (dropped ${trimsDropped} slug collision(s)) onto "${current.slug}", deleted "overview".`);
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
