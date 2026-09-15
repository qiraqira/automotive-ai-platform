import { prisma } from "@automotive/database";
import { fetchCarInfobox, parseProductionYears } from "./lib/wikipedia-car.js";
import { fetchCommonsFileInfo } from "./lib/commons-search.js";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";
import { seedEpaTrimsForNameplate } from "./lib/epa-trims.js";

// One-off: the original auto-seed-catalog.ts run resolved "Alfa Romeo
// Giulia" to the CLASSIC 1962-1978 Giulia (the plain, undisambiguated
// Wikipedia title) instead of the modern 2015-present one (real title:
// "Alfa Romeo Giulia (2015)") — a real wrong-car mismatch, not just a
// placeholder-name issue, found live reviewing the catalog 2026-09-15.
// Corrects the generation's real dates/name from the RIGHT infobox and
// replaces whatever photo was attached (the classic car's own, almost
// certainly) with the modern car's real infobox image.

const CURRENT_YEAR = new Date().getFullYear();

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "alfa-romeo" } });
  const giulia = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand!.id, slug: "giulia" } } });
  const gen = await prisma.generation.findFirst({ where: { carModelId: giulia!.id } });
  if (!gen) throw new Error("No generation found for Alfa Romeo Giulia");

  const infobox = await fetchCarInfobox("Alfa Romeo Giulia (2015)");
  const { startYear, endYear } = parseProductionYears(infobox.clean.production);
  await prisma.generation.update({ where: { id: gen.id }, data: { name: "First Generation (952)", startYear, endYear } });
  console.log(`Updated generation dates: ${startYear}-${endYear ?? "present"}`);

  const oldPhotos = await prisma.carModelImage.findMany({ where: { carModelId: giulia!.id } });
  for (const p of oldPhotos) {
    await prisma.carModelImage.delete({ where: { id: p.id } });
  }
  console.log(`Removed ${oldPhotos.length} old (wrong-car) photo(s).`);

  const filename = infobox.clean.image?.split("|")[0]?.trim();
  if (filename) {
    const file = await fetchCommonsFileInfo(filename);
    if (file) {
      await attachCarModelPhoto(
        giulia!.id,
        {
          sourceUrl: file.fullUrl,
          provider: "Wikimedia Commons",
          licenseSlug: file.licenseSlug,
          licenseUrl: file.licenseUrl,
          attributionRequired: file.attributionRequired,
          artist: file.artist,
          altText: "Alfa Romeo Giulia (First Generation, 952)",
        },
        "HERO",
        0,
        gen.id,
      );
      console.log("Attached real photo for the modern (952) Giulia.");
    } else {
      console.log("WARNING: Commons lookup failed for the modern Giulia's own infobox image.");
    }
  }

  const preferredYear = Math.min(endYear ?? CURRENT_YEAR - 1, CURRENT_YEAR - 1);
  if (startYear && preferredYear >= startYear) {
    const trims = await seedEpaTrimsForNameplate(gen.id, "Alfa Romeo", "Giulia", preferredYear);
    console.log(`Seeded ${trims} real trims.`);
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
