import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// One-shot CLI entrypoint (`npm run seed:model3 --workspace @automotive/worker`).
// Fourth catalog entry via the manual/session-editor path (see
// seed-corolla.ts's header for the full rationale) — zero AI provider
// calls anywhere in this file. No official Tesla-channel video could be
// confirmed via YouTube oEmbed (the one plausible "Official Reveal"
// result no longer resolves via oEmbed at all — likely private/removed
// — and every other result belonged to a third-party channel), so this
// entry ships with no CarVideo rows, matching this project's own "a
// wrong OFFICIAL label is worse than no video" rule already applied to
// seed-civic.ts.
//
// Tesla Model 3, "Highland" refresh (current generation since late
// 2023/early 2024). No horsepower/torque figures are recorded for any
// trim below — unlike the gas/hybrid catalog entries, no source found
// this session gave a confirently-sourced per-trim hp number for this
// generation (Tesla doesn't publish one the way it publishes battery/
// range/0-60 figures), so, per this project's "не выдумывать
// характеристики" rule, only the motor configuration is named and the
// real, sourced 0-60 time stands in as the performance figure instead
// of a invented hp number — the same restraint seed-real-cars.ts's own
// Model Y Juniper trims already apply (see that file's
// `juniperStandard`/`juniperPremiumRwd` engine rows: motor description
// + fuel only, no powerHp).
//
// Sources (fetched 2026-09-13):
// - https://en.wikipedia.org/wiki/Tesla_Model_3 (Highland refresh date,
//   per-trim battery capacity, EPA range, 0-60 times — internally
//   consistent figures, used as the primary spec source)
// - https://www.cars.com/research/tesla-model_3-2026/ and
//   https://www.consumerreports.org/cars/tesla/model-3/2026/overview/
//   (per-trim MSRP — the $36,990 lowest and $54,990 highest price points
//   independently cross-matched exactly between both sources; the two
//   middle price points come from Cars.com alone)
// - https://www.iihs.org/ratings/vehicle/tesla/model-3-4-door-sedan/2026
//   (IIHS ratings — no Top Safety Pick award currently held, Marginal on
//   seat belt reminders)

async function attachModel3Photo(carModelId: string): Promise<void> {
  const existingHero = await prisma.carModelImage.findFirst({ where: { carModelId, role: "HERO" } });
  if (existingHero) {
    console.log("  Photo: HERO image already present, left untouched.");
    return;
  }
  // Wikimedia Commons, "2024 Tesla Model 3 Highland Performance AWD.jpg"
  // — viewed directly before use: a genuine Highland-refresh Model 3 at
  // an auto show, correct restyled front fascia and "MODEL 3" badge for
  // this generation. CC BY-SA 4.0, attribution required.
  const sourceUrl = "https://upload.wikimedia.org/wikipedia/commons/3/3c/2024_Tesla_Model_3_Highland_Performance_AWD.jpg";
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
            author: "Chanokchon",
            attribution: "Chanokchon — CC BY-SA 4.0, via Wikimedia Commons",
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
    data: { carModelId, imageId, role: "HERO", position: 0, altText: "A white Tesla Model 3 (Highland refresh) with a black roof, front three-quarter view at an auto show" },
  });
  console.log("  Photo: attached (human-verified, not AI-verified — no OpenAI call).");
}

async function main() {
  const tesla = await prisma.brand.upsert({
    where: { slug: "tesla" },
    update: {},
    create: { slug: "tesla", name: "Tesla", country: "US" },
  });

  const model3 = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: tesla.id, slug: "model-3" } },
    update: {},
    create: { brandId: tesla.id, slug: "model-3", name: "Model 3" },
  });

  // --- Highland (2023/2024-present) ---
  const highland = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: model3.id, slug: "highland" } },
    update: {},
    create: { carModelId: model3.id, slug: "highland", name: "Highland Refresh", startYear: 2023, endYear: null },
  });

  type TrimSpec = { slug: string; name: string; engineName: string; capacityKwh: number; rangeMiles: number; zeroToSixty: string };
  const trims: TrimSpec[] = [
    { slug: "rwd", name: "RWD", engineName: "Single Motor (rear)", capacityKwh: 64, rangeMiles: 272, zeroToSixty: "5.8s" },
    { slug: "premium-rwd", name: "Premium RWD", engineName: "Single Motor (rear), long-range battery", capacityKwh: 78.1, rangeMiles: 363, zeroToSixty: "4.9s" },
    { slug: "premium-awd", name: "Premium AWD", engineName: "Dual Motor (AWD)", capacityKwh: 78.1, rangeMiles: 346, zeroToSixty: "4.2s" },
    { slug: "performance", name: "Performance", engineName: "Dual Motor Performance (AWD)", capacityKwh: 78.1, rangeMiles: 309, zeroToSixty: "2.9s" },
  ];

  for (const t of trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: highland.id, slug: t.slug } },
      update: {},
      create: { generationId: highland.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: `${t.engineName} — 0-60 mph in ${t.zeroToSixty}`, fuel: "electric" } });
    }
    const existingBattery = await prisma.battery.findFirst({ where: { trimId: trim.id } });
    if (!existingBattery) {
      await prisma.battery.create({ data: { trimId: trim.id, capacityKwh: t.capacityKwh, rangeMiles: t.rangeMiles } });
    }
  }

  // --- Facts ---
  const usMarket = await prisma.market.findFirst({ where: { code: "US" } });
  if (usMarket) {
    const existingPriceFact = await prisma.fact.findFirst({ where: { carModelId: model3.id, attribute: "starting_msrp_rwd_2026" } });
    if (!existingPriceFact) {
      await prisma.fact.create({
        data: {
          carModelId: model3.id,
          attribute: "starting_msrp_rwd_2026",
          value: "36990",
          unit: "usd",
          marketId: usMarket.id,
          status: "CONFIRMED",
          confidence: 0.85,
        },
      });
    }
  }

  await attachModel3Photo(model3.id);

  // --- Crash test: IIHS — another real, non-obvious "no Top Safety
  // Pick" result, this time driven by a Marginal seat belt reminder
  // score rather than a crashworthiness test, alongside merely
  // Acceptable (not Good) headlights.
  const existingCrashTest = await prisma.crashTestResult.findFirst({
    where: { carModelId: model3.id, generationId: highland.id, organization: "IIHS", testYear: 2025 },
  });
  if (!existingCrashTest) {
    await prisma.crashTestResult.create({
      data: {
        carModelId: model3.id,
        generationId: highland.id,
        organization: "IIHS",
        overallRating: "No Top Safety Pick award (Marginal seat belt reminders, Acceptable headlights)",
        testYear: 2025,
        sourceUrl: "https://www.iihs.org/ratings/vehicle/tesla/model-3-4-door-sedan/2026",
        categoryScores: {
          small_overlap_front: "Good",
          moderate_overlap_front: "Acceptable",
          side: "Good",
          headlights: "Acceptable",
          front_crash_prevention_vehicle: "Good",
          front_crash_prevention_pedestrian: "Good",
          seat_belt_reminders: "Marginal",
        },
      },
    });
    console.log("  Crash test: IIHS 2025 (no Top Safety Pick) — created.");
  } else {
    console.log("  Crash test: IIHS 2025 result already present, left untouched.");
  }

  console.log(`Seeded real data: Brand ${tesla.name} (${tesla.id}), CarModel ${model3.name} (${model3.id})`);
  console.log(`  Generation: Highland Refresh (${highland.id}), ${trims.length} trims`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
