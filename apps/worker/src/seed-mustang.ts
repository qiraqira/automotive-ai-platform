import { prisma } from "@automotive/database";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

// One-shot CLI entrypoint (`npm run seed:mustang --workspace @automotive/worker`).
// Fifth catalog entry via the manual/session-editor path (see
// seed-corolla.ts's header for the full rationale), and the first built
// using the new deterministic parsers (lib/wikipedia-car.ts,
// lib/iihs.ts) added this same session instead of WebFetch calls for
// every lookup. Also the first entry with real, sourced multi-era
// history within a single generation (the S550's own three distinct GT
// power outputs across its 2015-2023 run) and a real historical bookend
// generation, per the user's explicit ask for "a full model review with
// its whole history," not just the currently-sold trims.
//
// Sources (fetched 2026-09-13, generation/engine backbone via this
// session's own new `npm run fetch:infobox` parser against Wikipedia's
// {{Infobox automobile}} template unless noted):
// - "Ford Mustang (seventh generation)" / "Ford Mustang (sixth
//   generation)" / "Ford Mustang (first generation)" Wikipedia infoboxes
//   (platform, production years, model codes, predecessor/successor)
// - https://en.wikipedia.org/wiki/Ford_Mustang_(seventh_generation) and
//   .../Ford_Mustang_(sixth_generation) article bodies (exact hp/torque
//   figures per engine/era — not in the infobox itself)
// - https://www.cars.com/research/ford-mustang-2026/ (2026 US trim
//   pricing)
// - IIHS via this session's own `npm run fetch:iihs` parser against
//   https://www.iihs.org/ratings/vehicle/ford/mustang-2-door-coupe/2024
// - GTD price (~$318,760 base): cross-checked across Autoblog, TopSpeed,
//   and MotorBriefUSA — all independent secondary outlets, not Ford's
//   own site (which returned HTTP 403 to direct fetch), so recorded as a
//   Fact with slightly lower confidence than a primary-sourced one
//   rather than skipped outright, given three independent outlets agree
//   on the exact same figure.

async function main() {
  const ford = await prisma.brand.upsert({
    where: { slug: "ford" },
    update: {},
    create: { slug: "ford", name: "Ford", country: "US" },
  });

  const mustang = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: ford.id, slug: "mustang" } },
    update: {},
    create: { brandId: ford.id, slug: "mustang", name: "Mustang" },
  });

  // --- First generation (1965-1973) — historical bookend, no
  // trim/engine breakdown attempted for a 60-year-old lineup; the point
  // here is establishing the real lineage, not a full period-correct
  // spec sheet. ---
  const firstGen = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: mustang.id, slug: "first-gen" } },
    update: {},
    create: { carModelId: mustang.id, slug: "first-gen", name: "First Generation", startYear: 1965, endYear: 1973 },
  });
  void firstGen;

  const existingLaunchFact = await prisma.fact.findFirst({ where: { carModelId: mustang.id, attribute: "first_generation_launch" } });
  if (!existingLaunchFact) {
    await prisma.fact.create({
      data: {
        carModelId: mustang.id,
        attribute: "first_generation_launch",
        value:
          "Production of the original Mustang began in March 1964, sold as a 1965 model — the famous public debut came a month later at the 1964 New York World's Fair. Designed by Gale Halderman, it shared its underlying platform with the Ford Falcon and was related to the Mercury Cougar, Mercury Comet, and Ford Ranchero.",
        status: "CONFIRMED",
        confidence: 0.9,
      },
    });
  }

  // --- Sixth generation (S550, 2015-2023) — real multi-era engine
  // outputs across its 8-year run, not just a single launch spec. ---
  const s550 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: mustang.id, slug: "s550" } },
    update: {},
    create: { carModelId: mustang.id, slug: "s550", name: "Sixth Generation (S550)", startYear: 2015, endYear: 2023 },
  });

  type TrimSpec = { slug: string; name: string; engineName: string; powerHp: number; fuel: string };
  const s550Trims: TrimSpec[] = [
    { slug: "ecoboost", name: "EcoBoost", engineName: "2.3L Turbo I4", powerHp: 310, fuel: "petrol" },
    { slug: "v6", name: "V6 (2015-2017 only)", engineName: "3.7L Cyclone V6", powerHp: 305, fuel: "petrol" },
    { slug: "gt-2015", name: "GT (2015-2017)", engineName: "5.0L Coyote V8", powerHp: 435, fuel: "petrol" },
    { slug: "gt-2018", name: "GT (2018-2021 facelift)", engineName: "5.0L Coyote V8", powerHp: 460, fuel: "petrol" },
    { slug: "gt-2022", name: "GT (2022-2023, emissions-reduced)", engineName: "5.0L Coyote V8", powerHp: 450, fuel: "petrol" },
    { slug: "shelby-gt350", name: "Shelby GT350", engineName: "5.2L Voodoo V8", powerHp: 526, fuel: "petrol" },
    { slug: "shelby-gt500", name: "Shelby GT500", engineName: "5.2L Predator Supercharged V8", powerHp: 760, fuel: "petrol" },
  ];
  for (const t of s550Trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: s550.id, slug: t.slug } },
      update: {},
      create: { generationId: s550.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, fuel: t.fuel } });
    }
  }

  // --- Seventh generation (S650, 2023-present) ---
  const s650 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: mustang.id, slug: "s650" } },
    update: {},
    create: { carModelId: mustang.id, slug: "s650", name: "Seventh Generation (S650)", startYear: 2023, endYear: null },
  });

  const s650Trims: TrimSpec[] = [
    { slug: "ecoboost", name: "EcoBoost", engineName: "2.3L EcoBoost I4", powerHp: 315, fuel: "petrol" },
    { slug: "gt", name: "GT", engineName: "5.0L Coyote V8", powerHp: 480, fuel: "petrol" },
    { slug: "dark-horse", name: "Dark Horse", engineName: "5.0L Coyote V8 (Dark Horse tune)", powerHp: 500, fuel: "petrol" },
    { slug: "gtd", name: "GTD", engineName: "5.2L Predator Supercharged V8", powerHp: 815, fuel: "petrol" },
  ];
  for (const t of s650Trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: s650.id, slug: t.slug } },
      update: {},
      create: { generationId: s650.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, fuel: t.fuel } });
    }
  }

  // --- Facts: current pricing anchor + GTD halo price + the real IIHS gap ---
  const usMarket = await prisma.market.findFirst({ where: { code: "US" } });
  if (usMarket) {
    const existingPriceFact = await prisma.fact.findFirst({ where: { carModelId: mustang.id, attribute: "starting_msrp_ecoboost_2026" } });
    if (!existingPriceFact) {
      await prisma.fact.create({
        data: {
          carModelId: mustang.id,
          attribute: "starting_msrp_ecoboost_2026",
          value: "32995",
          unit: "usd",
          marketId: usMarket.id,
          status: "CONFIRMED",
          confidence: 0.85,
        },
      });
    }
    const existingGtdFact = await prisma.fact.findFirst({ where: { carModelId: mustang.id, attribute: "gtd_starting_price_2026" } });
    if (!existingGtdFact) {
      await prisma.fact.create({
        data: {
          carModelId: mustang.id,
          attribute: "gtd_starting_price_2026",
          value: "318760",
          unit: "usd",
          marketId: usMarket.id,
          status: "CONFIRMED",
          confidence: 0.7,
        },
      });
    }
  }

  const existingIihsGapFact = await prisma.fact.findFirst({ where: { carModelId: mustang.id, attribute: "iihs_rating_is_stale" } });
  if (!existingIihsGapFact) {
    await prisma.fact.create({
      data: {
        carModelId: mustang.id,
        attribute: "iihs_rating_is_stale",
        value:
          "IIHS's own published Mustang rating is based on 2015-2016 model-year testing — a Marginal LATCH ease-of-use score and an Acceptable (driver-side only; passenger side was never tested) small overlap front rating carry forward to the current listing with no re-test under IIHS's updated, harder moderate overlap front protocol that most current sedans/SUVs have already been re-rated under. No Top Safety Pick award of any kind is shown.",
        status: "CONFIRMED",
        confidence: 0.9,
      },
    });
  }

  // --- Photos: Wikimedia Commons, "2024 Ford Mustang GT 5.0 v8/v9.jpg"
  // — both viewed directly before use: a genuine S650 GT in Grabber
  // Blue-adjacent grey at a US dealership, correct grille/headlight/hood
  // vent shape for this generation. CC0, no attribution required.
  await attachCarModelPhoto(
    mustang.id,
    {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/3/3e/2024_Ford_Mustang_GT_5.0_v8.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/deed.en",
      attributionRequired: false,
      artist: "Fercavanha",
      altText: "A grey 2024 Ford Mustang GT 5.0, seventh generation, front three-quarter view",
    },
    "HERO",
    0,
  );
  await attachCarModelPhoto(
    mustang.id,
    {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/6/63/2024_Ford_Mustang_GT_5.0_v9.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/deed.en",
      attributionRequired: false,
      artist: "Fercavanha",
      altText: "A grey 2024 Ford Mustang GT 5.0, seventh generation, side profile view",
    },
    "GALLERY",
    1,
  );

  console.log(`Seeded real data: Brand ${ford.name} (${ford.id}), CarModel ${mustang.name} (${mustang.id})`);
  console.log(`  Generations: First (${firstGen.id}), S550 (${s550.id}, ${s550Trims.length} trims), S650 (${s650.id}, ${s650Trims.length} trims)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
