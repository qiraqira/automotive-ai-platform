import { prisma } from "@automotive/database";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";
import { fetchCommonsFileInfo } from "./lib/commons-search.js";
import { seedEpaTrimsForNameplate } from "./lib/epa-trims.js";

// One-shot CLI entrypoint (`npm run backfill:xc90-history --workspace
// @automotive/worker`). Third model taken to the "genuinely complete
// generation history" standard (after the X5 and GLE), and the first
// one built from auto-seed-catalog.ts's own output rather than a
// hand-seeded starting point — the auto-seed run had only created one
// placeholder "Overview" generation spanning 2002–present, which is
// exactly the shallow-fallback shape this project's own quality rules
// reject (a single generation can't honestly cover a 2002 P2-platform
// truck-based XC90 and a 2025 SPA-platform one as if nothing changed).
//
// Source (fetched 2026-09-15): Wikipedia's "Volvo XC90" article is a
// single page covering both generations (no separate "Volvo XC90
// (2002)"/"(2014)" articles exist the way BMW X5's chassis-code pages
// do) — confirmed via its own section headers ("First generation
// (2002–2014)", "Second generation (2015)") and two nested per-section
// {{Infobox automobile}} blocks giving each generation's own platform
// and lead photo. EPA's own fueleconomy.gov trim-name history
// (fetchNameplateHistory, run live this session) independently confirms
// the same break: flat "XC90 AWD/FWD" trim names 2003–2014, then
// "AWD/AWD PHEV/FWD" 2016–2021, then a further T5/T6/T8 (2022) and
// B5/B6/T8 (2023-24) mild-hybrid renaming — consistent with the 2019
// and 2024 facelifts the Wikipedia article itself documents as
// updates within the second generation, not new generations.

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "volvo" } });
  if (!brand) throw new Error("Volvo brand not found.");
  const xc90 = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: "xc90" } } });
  if (!xc90) throw new Error("XC90 CarModel not found.");

  const overview = await prisma.generation.findFirst({ where: { carModelId: xc90.id, slug: "overview" } });

  const first = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: xc90.id, slug: "first-generation" } },
    update: {},
    create: {
      carModelId: xc90.id,
      slug: "first-generation",
      name: "First Generation",
      startYear: 2002,
      endYear: 2014,
    },
  });
  const second = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: xc90.id, slug: "second-generation" } },
    update: {},
    create: {
      carModelId: xc90.id,
      slug: "second-generation",
      name: "Second Generation",
      startYear: 2015,
      endYear: null,
    },
  });

  if (await prisma.fact.count({ where: { carModelId: xc90.id, attribute: "first_gen_platform" } }) === 0) {
    await prisma.fact.create({
      data: { carModelId: xc90.id, attribute: "first_gen_platform", value: "Volvo P2 platform (2002–2014)", status: "REPORTED", confidence: 0.6 },
    });
  }
  if (await prisma.fact.count({ where: { carModelId: xc90.id, attribute: "second_gen_platform" } }) === 0) {
    await prisma.fact.create({
      data: { carModelId: xc90.id, attribute: "second_gen_platform", value: "Volvo SPA (Scalable Product Architecture) platform (2015–present)", status: "REPORTED", confidence: 0.6 },
    });
  }

  // The existing model-level HERO (from the auto-seed run) is a 2025
  // facelift photo, i.e. genuinely second-generation — relink it there
  // instead of leaving it attached to the placeholder "Overview"
  // generation this script is retiring.
  const existingHero = await prisma.carModelImage.findFirst({ where: { carModelId: xc90.id, role: "HERO", position: 0 } });
  if (existingHero && existingHero.generationId !== second.id) {
    await prisma.carModelImage.update({ where: { id: existingHero.id }, data: { generationId: second.id } });
    console.log("  Existing HERO (2025 facelift photo) relinked to Second Generation.");
  }

  // Real, human-verified first-generation photo — this article's own
  // "First generation" section infobox image (2011, a European-market
  // wagon-bodied 2.5T, P28 chassis code). Looked up via Commons' API
  // (not a hand-typed URL) so the hash-prefixed upload path, license
  // and artist all come from the real file record, not a guess.
  const firstGenPhoto = await fetchCommonsFileInfo("2005 Volvo XC90 (P28 MY05) 2.5 T wagon (2011-11-18) 01.jpg");
  if (firstGenPhoto) {
    await attachCarModelPhoto(
      xc90.id,
      {
        sourceUrl: firstGenPhoto.fullUrl,
        provider: "Wikimedia Commons",
        licenseSlug: firstGenPhoto.licenseSlug,
        licenseUrl: firstGenPhoto.licenseUrl,
        attributionRequired: firstGenPhoto.attributionRequired,
        artist: firstGenPhoto.artist,
        altText: "Volvo XC90 (first generation, P2 platform), 2005 model year",
      },
      "GALLERY",
      1,
      first.id,
    );
  } else {
    console.log("  WARNING: first-generation Commons photo lookup failed — no gallery photo attached for First Generation.");
  }

  if (overview) {
    const strandedTrims = await prisma.trim.count({ where: { generationId: overview.id } });
    const strandedPhotos = await prisma.carModelImage.count({ where: { generationId: overview.id } });
    if (strandedTrims === 0 && strandedPhotos === 0) {
      await prisma.generation.delete({ where: { id: overview.id } });
      console.log("  Deleted placeholder 'Overview' generation (2002–present) — replaced by the two real generations above.");
    } else {
      console.log(`  NOT deleting 'Overview' generation — still has ${strandedTrims} trim(s)/${strandedPhotos} photo(s) attached.`);
    }
  }

  const firstTrims = await seedEpaTrimsForNameplate(first.id, "Volvo", "XC90", 2012);
  const secondTrims = await seedEpaTrimsForNameplate(second.id, "Volvo", "XC90", 2023);

  console.log(`Backfilled: Volvo XC90 — First Generation (${first.id}, ${firstTrims} trims), Second Generation (${second.id}, ${secondTrims} trims).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
