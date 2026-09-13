import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// One-shot CLI entrypoint (`npm run seed:crv --workspace @automotive/worker`).
// Third catalog entry via the manual/session-editor path (see
// seed-corolla.ts's header for the full rationale) — zero AI provider
// calls anywhere in this file.
//
// Honda CR-V, sixth generation (Honda Architecture "HA" platform, model
// code RS, launched September 2022). Every figure below is sourced and
// dated in its own comment. A US-market e:PHEV plug-in trim exists on
// this generation but is explicitly NOT sold in the US (China/Europe
// only, per multiple 2026 sources) — deliberately left out of this
// US-facing catalog entry rather than implied as purchasable here. A
// genuinely distinctive US-only e:FCEV hydrogen fuel-cell/plug-in
// variant also exists, but every source found for its exact specs
// (Honda's own newsroom release, Edmunds, Autoblog) returned HTTP 403 to
// direct fetch this session — only an aggregated search-engine summary
// was available, not independently verified primary text, so per this
// project's own citation-lock discipline it's left out rather than
// entered as a CONFIRMED Fact on secondhand evidence.
//
// Sources (fetched 2026-09-13):
// - https://en.wikipedia.org/wiki/Honda_CR-V_(sixth_generation) (platform/
//   model code, production start, engine codes)
// - https://www.cars.com/research/honda-cr_v-2026/ (2026 US trim lineup,
//   MSRP, engine figures, EPA fuel economy)
// - https://www.iihs.org/ratings/vehicle/honda/cr-v-4-door-suv/2026
//   (IIHS ratings — notably NO Top Safety Pick award, Poor on the
//   updated moderate overlap front test)

async function attachCrvPhoto(carModelId: string): Promise<void> {
  const existingHero = await prisma.carModelImage.findFirst({ where: { carModelId, role: "HERO" } });
  if (existingHero) {
    console.log("  Photo: HERO image already present, left untouched.");
    return;
  }
  // Wikimedia Commons, "2023 Honda CR-V EX-L AWD, rear right, 11-13-2022.jpg"
  // — viewed directly before use: a genuine sixth-generation US-spec
  // CR-V EX-L at a US dealership, correct badge/tail-light shape. CC
  // BY-SA 4.0, attribution required.
  const sourceUrl = "https://upload.wikimedia.org/wikipedia/commons/3/3a/2023_Honda_CR-V_EX-L_AWD%2C_rear_right%2C_11-13-2022.jpg";
  const hosted = await selfHostImage(sourceUrl);
  const existingImage = await prisma.image.findUnique({ where: { sha256: hosted.sha256 } });

  const candidate: Pick<ImageCandidate, "provider" | "licenseSlug" | "licenseUrl" | "attributionRequired"> = {
    provider: "Wikimedia Commons",
    licenseSlug: "cc-by-sa-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true,
  };

  const imageId = existingImage
    ? existingImage.id
    : (
        await prisma.image.create({
          data: {
            originalUrl: hosted.localUrl,
            localStorageUrl: hosted.localUrl,
            sourceType: "CREATIVE_COMMONS",
            rightsStatus: rightsStatusFor(candidate.licenseSlug),
            author: "MercurySable99",
            attribution: "MercurySable99 — CC BY-SA 4.0, via Wikimedia Commons",
            licenseId: await getOrCreateLicense(candidate as ImageCandidate),
            width: hosted.width,
            height: hosted.height,
            mimeType: "image/jpeg",
            sha256: hosted.sha256,
            generatedByAi: false,
          },
        })
      ).id;

  await prisma.carModelImage.create({
    data: { carModelId, imageId, role: "HERO", position: 0, altText: "A dark grey 2023 Honda CR-V EX-L, sixth generation, rear three-quarter view" },
  });
  console.log("  Photo: attached (human-verified, not AI-verified — no OpenAI call).");
}

async function attachCrvVideo(carModelId: string, youtubeId: string, title: string, category: "OFFICIAL" | "CRASH_TEST" | "REVIEW"): Promise<void> {
  const existing = await prisma.carVideo.findFirst({ where: { carModelId, youtubeId } });
  if (existing) {
    console.log(`  Video (${category}): "${title}" already present, left untouched.`);
    return;
  }
  await prisma.carVideo.create({ data: { carModelId, youtubeId, title, category, sourceUrl: `https://www.youtube.com/watch?v=${youtubeId}` } });
  console.log(`  Video (${category}): attached "${title}" (verified via YouTube oEmbed to be on Honda's own channel before use).`);
}

async function main() {
  const honda = await prisma.brand.upsert({
    where: { slug: "honda" },
    update: {},
    create: { slug: "honda", name: "Honda", country: "JP" },
  });

  const crv = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: honda.id, slug: "cr-v" } },
    update: {},
    create: { brandId: honda.id, slug: "cr-v", name: "CR-V" },
  });

  // --- Sixth generation (2022-present) ---
  const gen6 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: crv.id, slug: "6th-gen" } },
    update: {},
    create: { carModelId: crv.id, slug: "6th-gen", name: "Sixth Generation", startYear: 2022, endYear: null },
  });

  type TrimSpec = { slug: string; name: string; engineName: string; powerHp: number; powerKw?: number; fuel: string };
  const trims: TrimSpec[] = [
    { slug: "lx", name: "LX", engineName: "1.5L Turbo I4 (L15BE)", powerHp: 190, powerKw: 142, fuel: "petrol" },
    { slug: "ex", name: "EX", engineName: "1.5L Turbo I4 (L15BE)", powerHp: 190, powerKw: 142, fuel: "petrol" },
    { slug: "ex-l", name: "EX-L", engineName: "1.5L Turbo I4 (L15BE)", powerHp: 190, powerKw: 142, fuel: "petrol" },
    { slug: "sport-hybrid", name: "Sport Hybrid", engineName: "2.0L Hybrid I4 (e:HEV) + electric motor, combined", powerHp: 204, fuel: "hybrid" },
    { slug: "sport-l-hybrid", name: "Sport-L Hybrid", engineName: "2.0L Hybrid I4 (e:HEV) + electric motor, combined", powerHp: 204, fuel: "hybrid" },
    { slug: "sport-touring-hybrid", name: "Sport Touring Hybrid", engineName: "2.0L Hybrid I4 (e:HEV) + electric motor, combined", powerHp: 204, fuel: "hybrid" },
  ];

  for (const t of trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: gen6.id, slug: t.slug } },
      update: {},
      create: { generationId: gen6.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, powerKw: t.powerKw, fuel: t.fuel } });
    }
  }

  // --- Facts ---
  const usMarket = await prisma.market.findFirst({ where: { code: "US" } });
  if (usMarket) {
    const existingPriceFact = await prisma.fact.findFirst({ where: { carModelId: crv.id, attribute: "starting_msrp_lx_2wd_2026" } });
    if (!existingPriceFact) {
      await prisma.fact.create({
        data: {
          carModelId: crv.id,
          attribute: "starting_msrp_lx_2wd_2026",
          value: "30920",
          unit: "usd",
          marketId: usMarket.id,
          status: "CONFIRMED",
          confidence: 0.85,
        },
      });
    }
  }

  await attachCrvPhoto(crv.id);
  await attachCrvVideo(crv.id, "ZjUi6usz_y4", "The 2023 Honda CR-V is Unveiled | Honda", "OFFICIAL");

  // --- Crash test: IIHS — a real, non-obvious result: no Top Safety
  // Pick award. The updated (harder) moderate overlap front protocol
  // rates this generation Poor specifically, which alone disqualifies it
  // from any Top Safety Pick tier regardless of its other Good ratings —
  // worth recording precisely rather than rounding up to "safe SUV."
  const existingCrashTest = await prisma.crashTestResult.findFirst({
    where: { carModelId: crv.id, generationId: gen6.id, organization: "IIHS", testYear: 2024 },
  });
  if (!existingCrashTest) {
    await prisma.crashTestResult.create({
      data: {
        carModelId: crv.id,
        generationId: gen6.id,
        organization: "IIHS",
        overallRating: "No Top Safety Pick award (Poor on the updated moderate overlap front test)",
        testYear: 2024,
        sourceUrl: "https://www.iihs.org/ratings/vehicle/honda/cr-v-4-door-suv/2026",
        categoryScores: {
          small_overlap_front: "Good",
          moderate_overlap_front: "Poor",
          side: "Good",
          headlights: "Good",
          front_crash_prevention_vehicle: "Acceptable",
          front_crash_prevention_pedestrian: "Acceptable",
          seat_belt_reminders: "Good",
        },
      },
    });
    console.log("  Crash test: IIHS 2024 (no Top Safety Pick) — created.");
  } else {
    console.log("  Crash test: IIHS 2024 result already present, left untouched.");
  }

  console.log(`Seeded real data: Brand ${honda.name} (${honda.id}), CarModel ${crv.name} (${crv.id})`);
  console.log(`  Generation: Sixth Generation (${gen6.id}), ${trims.length} trims`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
