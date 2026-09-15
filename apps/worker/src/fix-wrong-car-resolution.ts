import { prisma } from "@automotive/database";
import { fetchCarInfobox, parseProductionYears } from "./lib/wikipedia-car.js";
import { fetchCommonsFileInfo, searchCommonsCandidates } from "./lib/commons-search.js";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";
import { seedEpaTrimsForNameplate } from "./lib/epa-trims.js";

// Generalizes fix-alfa-giulia.ts: the original auto-seed-catalog.ts
// run's search fallback resolved several nameplates to an unrelated
// same-named car (a classic-era vehicle sharing the modern one's name)
// instead of the real modern one — found live reviewing the catalog
// 2026-09-15, one after another: Alfa Romeo Giulia (1962 classic vs.
// 2015-present), Jeep Gladiator (1962-1988 J-series truck vs. 2019-
// present JT), Maserati Ghibli (spanned both the 1967 GT and the 2013
// sedan as one fabricated range). Re-fetches from the CORRECT
// disambiguated Wikipedia title, replaces the (wrong-car) photo, and
// reseeds real EPA trims.
//
// `npm run fix:wrong-car --workspace @automotive/worker --
//   <brandSlug> <modelSlug> <epaModelName> "<Correct Wikipedia Title>"`

async function main() {
  const [brandSlug, modelSlug, epaModelName, correctTitle] = process.argv.slice(2);
  if (!brandSlug || !modelSlug || !epaModelName || !correctTitle) {
    console.error('Usage: npm run fix:wrong-car --workspace @automotive/worker -- <brandSlug> <modelSlug> <epaModelName> "<Correct Wikipedia Title>"');
    process.exitCode = 1;
    return;
  }

  const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
  if (!brand) throw new Error(`Brand "${brandSlug}" not found.`);
  const carModel = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug } } });
  if (!carModel) throw new Error(`CarModel "${brandSlug}/${modelSlug}" not found.`);
  const gen = await prisma.generation.findFirst({ where: { carModelId: carModel.id } });
  if (!gen) throw new Error(`No generation found for ${brandSlug}/${modelSlug}.`);

  const infobox = await fetchCarInfobox(correctTitle);
  const { startYear, endYear } = parseProductionYears(infobox.clean.production);
  await prisma.generation.update({ where: { id: gen.id }, data: { name: "First Generation", startYear, endYear } });
  console.log(`Updated generation dates: ${startYear}-${endYear ?? "present"}`);

  const oldPhotos = await prisma.carModelImage.findMany({ where: { carModelId: carModel.id } });
  for (const p of oldPhotos) await prisma.carModelImage.delete({ where: { id: p.id } });
  console.log(`Removed ${oldPhotos.length} old (wrong-car) photo(s).`);

  let file = null;
  const filename = infobox.clean.image?.split("|")[0]?.trim();
  if (filename) file = await fetchCommonsFileInfo(filename);
  if (!file) {
    const candidates = await searchCommonsCandidates(`${brand.name} ${carModel.name}`, 3);
    file = candidates[0] ?? null;
  }
  if (file) {
    await attachCarModelPhoto(
      carModel.id,
      {
        sourceUrl: file.fullUrl,
        provider: "Wikimedia Commons",
        licenseSlug: file.licenseSlug,
        licenseUrl: file.licenseUrl,
        attributionRequired: file.attributionRequired,
        artist: file.artist,
        altText: `${brand.name} ${carModel.name} (First Generation)`,
      },
      "HERO",
      0,
      gen.id,
    );
    console.log("Attached a real photo for the correct car.");
  } else {
    console.log("WARNING: no Commons photo found — left without one rather than guessing.");
  }

  const CURRENT_YEAR = new Date().getFullYear();
  const preferredYear = Math.min(endYear ?? CURRENT_YEAR - 1, CURRENT_YEAR - 1);
  if (startYear && preferredYear >= startYear) {
    const trims = await seedEpaTrimsForNameplate(gen.id, brand.name, epaModelName, preferredYear);
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
