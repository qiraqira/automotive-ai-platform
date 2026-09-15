import { prisma } from "@automotive/database";
import { fetchCommonsFileInfo } from "./lib/commons-search.js";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

// One-off: reviewing Chevrolet Camaro found its First (1967-1969) and
// Second (1970-1981) generation sections have zero photos — the shared
// "Chevrolet Camaro" Wikipedia article's combined format only gives
// nested infoboxes (and their photos) to the generations that happen to
// have one, and this pass's own model-level HERO already went to the
// current (Sixth) generation. Real Commons candidates found and
// eyeballed by hand (this project's own "a person looked at it" rule),
// same real-photo standard the rest of the catalog holds to.

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "chevrolet" } });
  const camaro = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand!.id, slug: "camaro" } } });
  const first = await prisma.generation.findFirst({ where: { carModelId: camaro!.id, slug: "first-generation" } });
  const second = await prisma.generation.findFirst({ where: { carModelId: camaro!.id, slug: "second-generation" } });

  const picks: { gen: typeof first; filename: string; altText: string }[] = [
    { gen: first, filename: "1967 Chevrolet Camaro (2469246170).jpg", altText: "Chevrolet Camaro (First generation), 1967" },
    { gen: second, filename: "1970 camaro z28.jpg", altText: "Chevrolet Camaro Z28 (Second generation), 1970" },
  ];

  for (const { gen, filename, altText } of picks) {
    if (!gen) continue;
    const file = await fetchCommonsFileInfo(filename);
    if (!file) {
      console.log(`[skip] "${filename}" not found or license-filtered.`);
      continue;
    }
    await attachCarModelPhoto(
      camaro!.id,
      {
        sourceUrl: file.fullUrl,
        provider: "Wikimedia Commons",
        licenseSlug: file.licenseSlug,
        licenseUrl: file.licenseUrl,
        attributionRequired: file.attributionRequired,
        artist: file.artist,
        altText,
      },
      "GALLERY",
      10 + (gen === first ? 0 : 1), // position 10/11, clear of the real per-generation indices (1-6) already used
      gen.id,
    );
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
