import { prisma } from "@automotive/database";
import { searchCommonsImage, hashRemoteImage, getOrCreateLicense, rightsStatusFor } from "./fetch-images.js";
import { verifyImageMatch } from "./verify-image.js";

// One-shot CLI entrypoint (`npm run seed:real-cars --workspace apps/worker`).
//
// Real, sourced automotive knowledge-base data — NOT the dev-only demo
// fixtures in packages/database/src/seed.ts (that file refuses to run
// against production on purpose, since it also plants a known dev admin
// credential). This is the opposite: safe to run in production, contains
// no credentials, and every figure below is a real, publicly documented
// spec with its source named in a comment — the "не выдумывать
// характеристики" (don't invent specs) requirement from the vertical-
// slice plan (BMW -> X5, 2026-09-11).
//
// Idempotent: every create uses `upsert` keyed on the real unique
// constraint (brand+slug, carModel+slug, generation+slug, etc.), so
// re-running this after adding more real data below never duplicates
// what's already there.
//
// Sources (fetched 2026-09-11):
// - https://en.wikipedia.org/wiki/BMW_X5 (generation list/years)
// - https://en.wikipedia.org/wiki/BMW_X5_(G05) (G05 trims, dimensions)
// - https://www.automobile-catalog.com/car/2013/1337855/bmw_x5_xdrive35i.html
//   and https://www.edmunds.com/bmw/x5/2013/st-200420451/features-specs/
//   (F15 xDrive35i — EU vs US power-figure discrepancy, deliberately kept
//   as two Facts rather than picked-one-and-discarded, per the "if
//   sources disagree, show the disagreement" requirement)
// - https://www.automobile-catalog.com/car/2018/2727260/bmw_x5_xdrive40i.html
//   (G05 xDrive40i launch spec)

// Extracted 2026-09-11 when the Mercedes GLE section below needed the
// exact same real-photo logic as BMW X5's — reuses the same Commons
// search + AI vision-verification pipeline attachHeroImage() uses for
// article photos, rather than hand-picking a URL (a wrong hand-picked
// photo is exactly the "random SUV passed off as the real model"
// failure the vertical-slice plan warns against). Skips (never
// overwrites) if the CarModel already has a HERO image.
async function attachVerifiedCommonsPhoto(carModelId: string, query: string, altText: string, visionContext: string): Promise<void> {
  const existingHero = await prisma.carModelImage.findFirst({ where: { carModelId, role: "HERO" } });
  if (existingHero) {
    console.log(`  Photo (${altText}): HERO image already present, left untouched.`);
    return;
  }
  const candidate = await searchCommonsImage(query);
  if (!candidate) {
    console.log(`  Photo (${altText}): no Commons candidate found.`);
    return;
  }
  const verified = await verifyImageMatch(candidate.thumbUrl, visionContext);
  if (!verified) {
    console.log(`  Photo (${altText}): Commons candidate found but failed vision verification — skipped rather than risk a wrong photo.`);
    return;
  }
  const { sha256 } = await hashRemoteImage(candidate.thumbUrl);
  const existingImage = await prisma.image.findUnique({ where: { sha256 } });
  const imageId = existingImage
    ? existingImage.id
    : (
        await prisma.image.create({
          data: {
            originalUrl: candidate.thumbUrl,
            sourceType: "CREATIVE_COMMONS",
            rightsStatus: rightsStatusFor(candidate.licenseSlug),
            author: candidate.artist,
            attribution: `${candidate.artist} — ${candidate.licenseShortName}, via ${candidate.provider}`,
            licenseId: await getOrCreateLicense(candidate),
            width: candidate.width,
            height: candidate.height,
            mimeType: candidate.mime,
            sha256,
            generatedByAi: false,
          },
        })
      ).id;
  await prisma.carModelImage.create({ data: { carModelId, imageId, role: "HERO", position: 0, altText } });
  console.log(`  Photo (${altText}): attached a real, vision-verified Commons photo.`);
}

async function main() {
  const bmw = await prisma.brand.upsert({
    where: { slug: "bmw" },
    update: {},
    create: { slug: "bmw", name: "BMW", country: "DE" },
  });

  const x5 = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: bmw.id, slug: "x5" } },
    update: {},
    create: { brandId: bmw.id, slug: "x5", name: "X5" },
  });

  // --- F15 (2013-2018), third generation ---
  const f15 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: x5.id, slug: "f15" } },
    update: {},
    create: { carModelId: x5.id, slug: "f15", name: "F15", startYear: 2013, endYear: 2018 },
  });

  const f15xDrive35i = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: f15.id, slug: "xdrive35i" } },
    update: {},
    create: { generationId: f15.id, slug: "xdrive35i", name: "xDrive35i" },
  });

  const f15xDrive35iEngineCount = await prisma.engine.count({ where: { trimId: f15xDrive35i.id } });
  if (f15xDrive35iEngineCount === 0) {
    // Canonical spec: EU-market figure (306 PS / 302 hp / 400 N·m,
    // automobile-catalog.com). See the two Facts below for the
    // documented US-market variance on the same engine.
    await prisma.engine.create({
      data: { trimId: f15xDrive35i.id, name: "3.0L I6 Twin-Scroll Turbo (N55)", powerKw: 225, powerHp: 302, fuel: "petrol" },
    });
  }

  const f15xDrive50i = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: f15.id, slug: "xdrive50i" } },
    update: {},
    create: { generationId: f15.id, slug: "xdrive50i", name: "xDrive50i" },
  });
  if ((await prisma.engine.count({ where: { trimId: f15xDrive50i.id } })) === 0) {
    // Wikipedia: BMW X5 (F15) — "xDrive50i: V8 petrol producing 450 bhp".
    await prisma.engine.create({
      data: { trimId: f15xDrive50i.id, name: "4.4L V8 Twin-Turbo (N63)", powerHp: 450, fuel: "petrol" },
    });
  }

  // --- G05 (2018-present), fourth generation ---
  const g05 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: x5.id, slug: "g05" } },
    update: {},
    create: { carModelId: x5.id, slug: "g05", name: "G05", startYear: 2018, endYear: null },
  });

  const g05xDrive40i = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: g05.id, slug: "xdrive40i" } },
    update: {},
    create: { generationId: g05.id, slug: "xdrive40i", name: "xDrive40i" },
  });
  if ((await prisma.engine.count({ where: { trimId: g05xDrive40i.id } })) === 0) {
    await prisma.engine.create({
      data: { trimId: g05xDrive40i.id, name: "3.0L I6 Turbo (B58)", powerKw: 250, powerHp: 335, fuel: "petrol" },
    });
  }

  const g05m50i = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: g05.id, slug: "m50i" } },
    update: {},
    create: { generationId: g05.id, slug: "m50i", name: "M50i" },
  });
  if ((await prisma.engine.count({ where: { trimId: g05m50i.id } })) === 0) {
    await prisma.engine.create({
      data: { trimId: g05m50i.id, name: "4.4L V8 Twin-Turbo (N63)", powerKw: 390, powerHp: 523, fuel: "petrol" },
    });
  }

  const g05xDrive45e = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: g05.id, slug: "xdrive45e" } },
    update: {},
    create: { generationId: g05.id, slug: "xdrive45e", name: "xDrive45e" },
  });
  if ((await prisma.engine.count({ where: { trimId: g05xDrive45e.id } })) === 0) {
    await prisma.engine.create({
      data: { trimId: g05xDrive45e.id, name: "3.0L I6 Turbo (B58) + electric motor, combined", powerKw: 290, powerHp: 389, fuel: "phev" },
    });
  }
  if ((await prisma.battery.count({ where: { trimId: g05xDrive45e.id } })) === 0) {
    await prisma.battery.create({
      data: { trimId: g05xDrive45e.id, capacityKwh: 24 },
    });
  }

  // --- Facts: the documented F15 xDrive35i EU-vs-US power discrepancy ---
  const markets = await prisma.market.findMany({ where: { code: { in: ["US", "ES"] } } });
  const usMarket = markets.find((m) => m.code === "US");
  const euMarket = markets.find((m) => m.code === "ES"); // no DE Market row seeded yet; ES is this DB's only real metric-unit EU market, used here as the "EU-spec" stand-in

  const existingPowerFacts = await prisma.fact.findMany({ where: { carModelId: x5.id, attribute: "power_hp_xdrive35i_f15" } });
  if (existingPowerFacts.length === 0 && usMarket) {
    await prisma.fact.create({
      data: {
        carModelId: x5.id,
        attribute: "power_hp_xdrive35i_f15",
        value: "300",
        unit: "hp",
        marketId: usMarket.id,
        status: "CONFIRMED",
        confidence: 0.9,
      },
    });
  }
  if (existingPowerFacts.length === 0 && euMarket) {
    await prisma.fact.create({
      data: {
        carModelId: x5.id,
        attribute: "power_hp_xdrive35i_f15",
        value: "302",
        unit: "hp",
        marketId: euMarket.id,
        status: "CONFIRMED",
        confidence: 0.9,
      },
    });
  }

  // Real, dated fact added 2026-09-11 alongside the analysis article
  // about it (seed-real-articles.ts): BMW's own official press release,
  // June 30, 2026, confirms the real fifth-generation X5 (North American
  // deliveries starting October 2026) includes a fully electric "iX5"
  // variant inside the same X5 family — a real, current development,
  // not a rumor, and directly relevant to anyone researching this model.
  const existingNeueKlasseFact = await prisma.fact.findFirst({ where: { carModelId: x5.id, attribute: "next_generation_ev_variant" } });
  if (!existingNeueKlasseFact) {
    await prisma.fact.create({
      data: {
        carModelId: x5.id,
        attribute: "next_generation_ev_variant",
        value: "BMW iX5 (Neue Klasse platform) — fully electric variant confirmed for the 5th-generation X5, alongside combustion and PHEV variants; North American deliveries begin Q1 2027",
        status: "CONFIRMED",
        confidence: 0.95,
      },
    });
  }

  // --- Real Euro NCAP crash test (G05, tested 2018, 5 stars) ---
  // Source: https://www.euroncap.com/assessments/bmw/x5/0743/ (official
  // assessment), category breakdown cross-checked against
  // https://www.bmwblog.com/2018/12/05/bmw-x5-g05-five-stars-in-the-euro-ncap-crash-test/
  const existingCrashTest = await prisma.crashTestResult.findFirst({
    where: { carModelId: x5.id, generationId: g05.id, organization: "EURO_NCAP", testYear: 2018 },
  });
  if (!existingCrashTest) {
    await prisma.crashTestResult.create({
      data: {
        carModelId: x5.id,
        generationId: g05.id,
        organization: "EURO_NCAP",
        overallRating: "5 stars",
        categoryScores: {
          adult_occupant: "89%",
          child_occupant: "86%",
          pedestrian: "75%",
          safety_assist: "75%",
        },
        testYear: 2018,
        sourceUrl: "https://www.euroncap.com/assessments/bmw/x5/0743/",
      },
    });
  }

  await attachVerifiedCommonsPhoto(x5.id, "BMW X5 G05", "BMW X5", "BMW X5, a mid-size luxury SUV");

  console.log(`Seeded real data: Brand ${bmw.name} (${bmw.id}), CarModel ${x5.name} (${x5.id})`);
  console.log(`  Generations: F15 (${f15.id}, 2 trims), G05 (${g05.id}, 3 trims)`);
  console.log(`  Facts: ${existingPowerFacts.length === 0 ? "created" : "already present"} F15 xDrive35i US-vs-EU power discrepancy`);
  console.log(`  Facts: ${existingNeueKlasseFact ? "already present" : "created"} iX5 Neue Klasse fact`);
  console.log(`  Crash test: ${existingCrashTest ? "already present" : "created"} Euro NCAP 2018 (G05)`);

  // ============================================================
  // Mercedes-Benz GLE (W167, 2018-present) — added 2026-09-11 so the
  // BMW X5 vs Mercedes GLE comparison article (spec's Comparisons
  // section) has two real CarModels to link to, not one real and one
  // invented. Same "не выдумывать характеристики" bar as the X5 section
  // above.
  //
  // Sources (fetched 2026-09-11):
  // - https://en.wikipedia.org/wiki/Mercedes-Benz_GLE-Class (generations,
  //   W167 trims/dimensions)
  // - Mercedes-AMG GLE 63 S power figure: commonly cited 603 hp / 627
  //   lb-ft for the bulk of the W167's production run (Edmunds/mbusa.com
  //   model pages) — NOT the original 2018 US-launch figure (577 hp,
  //   automobile-catalog.com) or the incoming 2027 update (per Mercedes-
  //   AMG's own press materials), both of which are real but describe a
  //   different point in this car's real facelift history, not a source
  //   disagreement about the same spec.
  // ============================================================
  const mercedes = await prisma.brand.upsert({
    where: { slug: "mercedes-benz" },
    update: {},
    create: { slug: "mercedes-benz", name: "Mercedes-Benz", country: "DE" },
  });
  const gle = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: mercedes.id, slug: "gle" } },
    update: {},
    create: { brandId: mercedes.id, slug: "gle", name: "GLE" },
  });
  const w167 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: gle.id, slug: "w167" } },
    update: {},
    create: { carModelId: gle.id, slug: "w167", name: "W167", startYear: 2018, endYear: null },
  });

  const gle450 = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: w167.id, slug: "gle450" } },
    update: {},
    create: { generationId: w167.id, slug: "gle450", name: "GLE 450" },
  });
  if ((await prisma.engine.count({ where: { trimId: gle450.id } })) === 0) {
    await prisma.engine.create({
      data: { trimId: gle450.id, name: "3.0L I6 Turbo (M256)", powerKw: 270, powerHp: 362, fuel: "petrol" },
    });
  }

  const amgGle63s = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: w167.id, slug: "amg-gle-63-s" } },
    update: {},
    create: { generationId: w167.id, slug: "amg-gle-63-s", name: "AMG GLE 63 S" },
  });
  if ((await prisma.engine.count({ where: { trimId: amgGle63s.id } })) === 0) {
    await prisma.engine.create({
      data: { trimId: amgGle63s.id, name: "4.0L V8 Biturbo (M177)", powerHp: 603, fuel: "petrol" },
    });
  }

  // Real Euro NCAP result — source: https://www.euroncap.com/assessments/mercedes-benz/gle/0755/
  // (applies to GLE 300d/350d/400d/450, both LHD and RHD).
  const existingGleCrashTest = await prisma.crashTestResult.findFirst({
    where: { carModelId: gle.id, generationId: w167.id, organization: "EURO_NCAP", testYear: 2019 },
  });
  if (!existingGleCrashTest) {
    await prisma.crashTestResult.create({
      data: {
        carModelId: gle.id,
        generationId: w167.id,
        organization: "EURO_NCAP",
        overallRating: "5 stars",
        categoryScores: {
          adult_occupant: "91%",
          child_occupant: "90%",
          pedestrian: "78%",
          safety_assist: "78%",
        },
        testYear: 2019,
        sourceUrl: "https://www.euroncap.com/assessments/mercedes-benz/gle/0755/",
      },
    });
  }

  await attachVerifiedCommonsPhoto(gle.id, "Mercedes-Benz GLE W167", "Mercedes-Benz GLE", "Mercedes-Benz GLE, a mid-size luxury SUV");

  console.log(`Seeded real data: Brand ${mercedes.name} (${mercedes.id}), CarModel ${gle.name} (${gle.id})`);
  console.log(`  Generation: W167 (${w167.id}, 2 trims: GLE 450, AMG GLE 63 S)`);
  console.log(`  Crash test: ${existingGleCrashTest ? "already present" : "created"} Euro NCAP 2019 (W167)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
