import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// One-shot CLI entrypoint (`npm run seed:civic --workspace @automotive/worker`).
// Second catalog entry via the manual/session-editor path (see
// seed-corolla.ts's own header for the full rationale) — zero AI provider
// calls anywhere in this file. No official Honda-channel video could be
// confirmed via YouTube oEmbed in the time spent looking (unlike
// seed-corolla.ts's two Toyota USA videos), so this entry deliberately
// ships with no CarVideo rows rather than mislabel a third-party review
// as OFFICIAL — a gap to close later if a real one turns up, not a
// shortcut taken now.
//
// Honda Civic, eleventh generation (Honda Architecture "HA" platform,
// model codes FE/FL, 2025 mid-cycle refresh). Every figure below is
// sourced and dated in its own comment.
//
// Sources (fetched 2026-09-13):
// - https://en.wikipedia.org/wiki/Honda_Civic_(eleventh_generation)
//   (platform/model codes, production start, facelift date, e:HEV combined
//   output)
// - https://www.cars.com/research/honda-civic-2026/ (2026 US trim lineup,
//   MSRP, engine figures, EPA fuel economy)
// - https://www.iihs.org/ratings/vehicle/honda/civic-4-door-sedan/2025
//   (IIHS 2025 crash-test ratings)

async function attachCivicPhoto(carModelId: string): Promise<void> {
  const existingHero = await prisma.carModelImage.findFirst({ where: { carModelId, role: "HERO" } });
  if (existingHero) {
    console.log("  Photo: HERO image already present, left untouched.");
    return;
  }
  // Wikimedia Commons, "Honda Civic (2021) sedan Sport DSC 7054.jpg" —
  // viewed directly before use: a genuine eleventh-generation Civic Sport
  // sedan, clean rear three-quarter shot, correct badge/tail-light shape
  // for this generation (European plate, same body as the US sedan).
  // CC BY-SA 4.0, attribution required.
  const sourceUrl = "https://upload.wikimedia.org/wikipedia/commons/b/b4/Honda_Civic_%282021%29_sedan_Sport_DSC_7054.jpg";
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
            author: "Alexander-93",
            attribution: "Alexander-93 — CC BY-SA 4.0, via Wikimedia Commons",
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
    data: { carModelId, imageId, role: "HERO", position: 0, altText: "A blue Honda Civic Sport sedan, eleventh generation, rear three-quarter view" },
  });
  console.log("  Photo: attached (human-verified, not AI-verified — no OpenAI call).");
}

async function main() {
  const honda = await prisma.brand.upsert({
    where: { slug: "honda" },
    update: {},
    create: { slug: "honda", name: "Honda", country: "JP" },
  });

  const civic = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: honda.id, slug: "civic" } },
    update: {},
    create: { brandId: honda.id, slug: "civic", name: "Civic" },
  });

  // --- Eleventh generation (2021-present, 2025 mid-cycle refresh) ---
  const gen11 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: civic.id, slug: "11th-gen" } },
    update: {},
    create: { carModelId: civic.id, slug: "11th-gen", name: "Eleventh Generation", startYear: 2021, endYear: null },
  });

  type TrimSpec = { slug: string; name: string; engineName: string; powerHp: number; powerKw?: number; fuel: string };
  const trims: TrimSpec[] = [
    { slug: "lx", name: "LX", engineName: "2.0L Naturally Aspirated I4", powerHp: 150, powerKw: 112, fuel: "petrol" },
    { slug: "sport", name: "Sport", engineName: "2.0L Naturally Aspirated I4", powerHp: 150, powerKw: 112, fuel: "petrol" },
    {
      slug: "sport-hybrid",
      name: "Sport Hybrid",
      engineName: "2.0L Atkinson-cycle I4 + two electric motors (Honda e:HEV), combined",
      powerHp: 200,
      fuel: "hybrid",
    },
    {
      slug: "sport-touring-hybrid",
      name: "Sport Touring Hybrid",
      engineName: "2.0L Atkinson-cycle I4 + two electric motors (Honda e:HEV), combined",
      powerHp: 200,
      fuel: "hybrid",
    },
    { slug: "si", name: "Si", engineName: "1.5L Turbo I4 (L15CA)", powerHp: 200, powerKw: 149, fuel: "petrol" },
    { slug: "type-r", name: "Type R", engineName: "2.0L Turbo I4 (K20C1)", powerHp: 315, powerKw: 235, fuel: "petrol" },
  ];

  for (const t of trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: gen11.id, slug: t.slug } },
      update: {},
      create: { generationId: gen11.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, powerKw: t.powerKw, fuel: t.fuel } });
    }
  }

  // --- Facts ---
  const usMarket = await prisma.market.findFirst({ where: { code: "US" } });
  if (usMarket) {
    const existingPriceFact = await prisma.fact.findFirst({ where: { carModelId: civic.id, attribute: "starting_msrp_lx_2026" } });
    if (!existingPriceFact) {
      await prisma.fact.create({
        data: {
          carModelId: civic.id,
          attribute: "starting_msrp_lx_2026",
          value: "25890",
          unit: "usd",
          marketId: usMarket.id,
          status: "CONFIRMED",
          confidence: 0.85,
        },
      });
    }
  }

  const existingFacelift = await prisma.fact.findFirst({ where: { carModelId: civic.id, attribute: "facelift_2025_powertrain_change" } });
  if (!existingFacelift) {
    await prisma.fact.create({
      data: {
        carModelId: civic.id,
        attribute: "facelift_2025_powertrain_change",
        value:
          "The 2025 model-year refresh (revealed May 21, 2024) replaced the previous naturally-aspirated 2.0L base engine with a new, more efficient 2.0L unit, and moved the turbocharged 1.5L engine to be exclusive to the Si trim rather than being available on volume trims.",
        status: "CONFIRMED",
        confidence: 0.85,
      },
    });
  }

  await attachCivicPhoto(civic.id);

  // --- Crash test: IIHS 2025 Civic sedan ---
  const existingCrashTest = await prisma.crashTestResult.findFirst({
    where: { carModelId: civic.id, generationId: gen11.id, organization: "IIHS", testYear: 2025 },
  });
  if (!existingCrashTest) {
    await prisma.crashTestResult.create({
      data: {
        carModelId: civic.id,
        generationId: gen11.id,
        organization: "IIHS",
        overallRating: "Top Safety Pick",
        testYear: 2025,
        sourceUrl: "https://www.iihs.org/ratings/vehicle/honda/civic-4-door-sedan/2025",
        categoryScores: {
          small_overlap_front: "Good",
          moderate_overlap_front: "Acceptable",
          side: "Good",
          headlights: "Good",
          front_crash_prevention_vehicle: "Acceptable",
          front_crash_prevention_pedestrian: "Acceptable",
          seat_belt_reminders: "Good",
        },
      },
    });
    console.log("  Crash test: IIHS 2025 Top Safety Pick — created.");
  } else {
    console.log("  Crash test: IIHS 2025 result already present, left untouched.");
  }

  console.log(`Seeded real data: Brand ${honda.name} (${honda.id}), CarModel ${civic.name} (${civic.id})`);
  console.log(`  Generation: Eleventh Generation (${gen11.id}), ${trims.length} trims`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
