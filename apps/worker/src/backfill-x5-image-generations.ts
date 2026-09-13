import { prisma } from "@automotive/database";

// One-shot CLI entrypoint (`npm run backfill:x5-image-generations --
// workspace @automotive/worker`). Follows the schema migration adding
// CarModelImage.generationId (2026-09-14) — patches the 4 X5 photos
// this session already attached (before that column existed) with the
// correct generation each one actually belongs to, so the car model
// page can render each photo inside its own generation's section
// instead of one undifferentiated top-of-page gallery.

const ALT_TEXT_TO_GENERATION_SLUG: Record<string, string> = {
  "BMW X5 (G05), fourth generation": "g05",
  "BMW X5 (E53), first generation, in Titanium Silver Metallic": "e53",
  "BMW X5 M (E70), second generation, front close-up": "e70",
  "BMW X5 xDrive35i (F15), third generation": "f15",
};

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "bmw" } });
  if (!brand) throw new Error("BMW brand not found.");
  const x5 = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: "x5" } } });
  if (!x5) throw new Error("X5 CarModel not found.");

  const images = await prisma.carModelImage.findMany({ where: { carModelId: x5.id, generationId: null } });
  for (const img of images) {
    const genSlug = img.altText ? ALT_TEXT_TO_GENERATION_SLUG[img.altText] : undefined;
    if (!genSlug) {
      console.log(`  Skipping image ${img.id} (altText "${img.altText}"): no known generation mapping.`);
      continue;
    }
    const generation = await prisma.generation.findFirst({ where: { carModelId: x5.id, slug: genSlug } });
    if (!generation) {
      console.log(`  Skipping image ${img.id}: generation "${genSlug}" not found.`);
      continue;
    }
    await prisma.carModelImage.update({ where: { id: img.id }, data: { generationId: generation.id } });
    console.log(`  Image ${img.id} ("${img.altText}") -> generation ${generation.name}.`);
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
