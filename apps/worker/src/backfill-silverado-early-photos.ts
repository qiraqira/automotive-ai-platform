import { prisma } from "@automotive/database";
import { fetchCommonsFileInfo } from "./lib/commons-search.js";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

// One-off, same pattern as backfill-camaro-classic-photos.ts: Chevrolet
// Silverado's First (GMT800, 1999-2006) and Second (GMT900, 2007-2012)
// generation sections had zero photos on the shared "Chevrolet
// Silverado" Wikipedia article. Real Commons candidates found and
// eyeballed by hand.

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "chevrolet" } });
  const silverado = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand!.id, slug: "silverado" } } });
  const gens = await prisma.generation.findMany({ where: { carModelId: silverado!.id }, orderBy: { startYear: "asc" } });
  const first = gens[0]!;
  const second = gens[1]!;

  const picks = [
    { gen: first, filename: "1999-2002 Chevrolet Silverado 1500 extended.jpg", altText: "Chevrolet Silverado (First-generation Silverado / second-generation Sierra, GMT800), 1999-2002" },
    { gen: second, filename: "2007-Chevrolet-Silverado-base-DC.jpg", altText: "Chevrolet Silverado (Second-generation Silverado / third-generation Sierra, GMT900), 2007" },
  ];

  for (const { gen, filename, altText } of picks) {
    const file = await fetchCommonsFileInfo(filename);
    if (!file) {
      console.log(`[skip] "${filename}" not found or license-filtered.`);
      continue;
    }
    await attachCarModelPhoto(
      silverado!.id,
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
      10 + (gen.id === first.id ? 0 : 1),
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
