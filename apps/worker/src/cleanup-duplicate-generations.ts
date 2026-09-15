import { prisma } from "@automotive/database";

// One-shot cleanup for a real bug in the (now-fixed) unattended sweep
// backfill-all-generations.ts ran on 2026-09-15 before its own target
// filter was tightened: it re-processed 4 models that already had one
// real, hand-seeded CURRENT-generation row from an earlier session
// (Dodge Charger, BMW 3 Series, BMW 5 Series, Chevrolet Camaro) and
// created a SECOND row for that same real generation under a different
// slug, from the newly-discovered full history. Neither duplicate is
// deleted outright — whichever trims/photos exist on the OLD row are
// real data and are moved onto the NEW row (which the rest of that
// nameplate's real generation history now points at) before the old,
// now-empty row is deleted.

const merges: { brandSlug: string; modelSlug: string; oldSlug: string; newSlug: string }[] = [
  { brandSlug: "bmw", modelSlug: "3-series", oldSlug: "g20", newSlug: "seventh-generation-g20-g21-g28-2018" },
  { brandSlug: "bmw", modelSlug: "5-series", oldSlug: "g60", newSlug: "eighth-generation-g60-g61-g68-2024" },
  { brandSlug: "chevrolet", modelSlug: "camaro", oldSlug: "6th-gen", newSlug: "sixth-generation" },
  { brandSlug: "dodge", modelSlug: "charger", oldSlug: "2024-lb", newSlug: "eighth-generation-2024-present-lb" },
];

async function main() {
  for (const { brandSlug, modelSlug, oldSlug, newSlug } of merges) {
    const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
    if (!brand) continue;
    const carModel = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug } } });
    if (!carModel) continue;
    const oldGen = await prisma.generation.findFirst({ where: { carModelId: carModel.id, slug: oldSlug } });
    const newGen = await prisma.generation.findFirst({ where: { carModelId: carModel.id, slug: newSlug } });
    if (!oldGen || !newGen) {
      console.log(`[skip] ${brandSlug}/${modelSlug}: old="${oldSlug}" (${oldGen ? "found" : "MISSING"}) new="${newSlug}" (${newGen ? "found" : "MISSING"})`);
      continue;
    }
    const trims = await prisma.trim.updateMany({ where: { generationId: oldGen.id }, data: { generationId: newGen.id } });
    const photos = await prisma.carModelImage.updateMany({ where: { generationId: oldGen.id }, data: { generationId: newGen.id } });
    await prisma.generation.delete({ where: { id: oldGen.id } });
    console.log(`[ok] ${brandSlug}/${modelSlug}: moved ${trims.count} trim(s), ${photos.count} photo(s) from "${oldSlug}" to "${newSlug}", deleted "${oldSlug}".`);
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
