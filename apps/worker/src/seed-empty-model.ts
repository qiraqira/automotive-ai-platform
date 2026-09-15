import { prisma } from "@automotive/database";
import { fetchCarInfobox, parseProductionYears } from "./lib/wikipedia-car.js";
import { fetchCommonsFileInfo, searchCommonsCandidates } from "./lib/commons-search.js";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";
import { seedEpaTrimsForNameplate } from "./lib/epa-trims.js";

// Complement to fix-wrong-car-resolution.ts: that script fixes a model
// that already has a (wrong) generation row. This handles the other
// gap found live reviewing the remaining unreviewed catalog 2026-09-15
// — several CarModel rows (Tesla Model S, Lucid Air, VW ID.4, Audi Q4
// e-tron, Nissan Ariya/Versa, Polestar 3, Ram 2500/ProMaster) were
// created with literally zero generations, images, or trims: the
// original auto-seed run never populated them at all. Most of these
// are single continuous-production nameplates with no real Wikipedia
// "generation" sub-articles, so the single-page/chassis-code section
// discovery in apply-generation-sections.ts correctly finds nothing —
// this seeds a single "First Generation" row directly from the page's
// own infobox instead, same as promote-single-generation-overview.ts
// does for pre-existing Overview placeholders, but for a model with no
// generation row to promote in the first place.
//
// `npm run seed:empty --workspace @automotive/worker --
//   <brandSlug> <modelSlug> <epaModelName> "<Wikipedia Title>"`

async function main() {
  const [brandSlug, modelSlug, epaModelName, wikipediaTitle] = process.argv.slice(2);
  if (!brandSlug || !modelSlug || !epaModelName || !wikipediaTitle) {
    console.error('Usage: npm run seed:empty --workspace @automotive/worker -- <brandSlug> <modelSlug> <epaModelName> "<Wikipedia Title>"');
    process.exitCode = 1;
    return;
  }

  const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
  if (!brand) throw new Error(`Brand "${brandSlug}" not found.`);
  const carModel = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug } } });
  if (!carModel) throw new Error(`CarModel "${brandSlug}/${modelSlug}" not found.`);

  const existing = await prisma.generation.findFirst({ where: { carModelId: carModel.id } });
  if (existing) throw new Error(`${brandSlug}/${modelSlug} already has a generation (${existing.id}) — use fix:wrong-car instead.`);

  const infobox = await fetchCarInfobox(wikipediaTitle);
  const { startYear, endYear } = parseProductionYears(infobox.clean.production);

  const gen = await prisma.generation.create({
    data: {
      carModelId: carModel.id,
      name: "First Generation",
      slug: "first-generation",
      startYear: startYear ?? null,
      endYear: endYear ?? null,
    },
  });
  console.log(`Created generation ${gen.id}: ${startYear}-${endYear ?? "present"}`);

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
    console.log("Attached a real photo.");
  } else {
    console.log("WARNING: no Commons photo found — left without one rather than guessing.");
  }

  const CURRENT_YEAR = new Date().getFullYear();
  const preferredYear = Math.min(endYear ?? CURRENT_YEAR - 1, CURRENT_YEAR - 1);
  if (startYear && preferredYear >= startYear) {
    const trims = await seedEpaTrimsForNameplate(gen.id, brand.name, epaModelName, preferredYear);
    console.log(`Seeded ${trims} real trims.`);
  } else {
    console.log("Skipped EPA trim seeding (no usable production year).");
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
