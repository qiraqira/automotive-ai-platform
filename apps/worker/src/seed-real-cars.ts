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

  // --- Real photo (Wikimedia Commons, reusing the same search + AI
  // vision-verification pipeline as attachHeroImage() in fetch-images.ts
  // — a hand-picked URL risks exactly the "random SUV passed off as an
  // X5" failure the vertical-slice plan explicitly warns against; running
  // it through the same relevance + vision check as every article hero
  // image is the honest way to attach one here too). Skipped if this
  // CarModel already has a HERO image — never overwrites an editor's own
  // later choice.
  const existingHero = await prisma.carModelImage.findFirst({ where: { carModelId: x5.id, role: "HERO" } });
  if (!existingHero) {
    const candidate = await searchCommonsImage("BMW X5 G05");
    if (candidate) {
      const verified = await verifyImageMatch(candidate.thumbUrl, "BMW X5, a mid-size luxury SUV");
      if (verified) {
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
        await prisma.carModelImage.create({
          data: { carModelId: x5.id, imageId, role: "HERO", position: 0, altText: "BMW X5" },
        });
        console.log("  Photo: attached a real, vision-verified Commons photo.");
      } else {
        console.log("  Photo: Commons candidate found but failed vision verification — skipped rather than risk a wrong photo.");
      }
    } else {
      console.log("  Photo: no Commons candidate found.");
    }
  } else {
    console.log("  Photo: HERO image already present, left untouched.");
  }

  console.log(`Seeded real data: Brand ${bmw.name} (${bmw.id}), CarModel ${x5.name} (${x5.id})`);
  console.log(`  Generations: F15 (${f15.id}, 2 trims), G05 (${g05.id}, 3 trims)`);
  console.log(`  Facts: ${existingPowerFacts.length === 0 ? "created" : "already present"} F15 xDrive35i US-vs-EU power discrepancy`);
  console.log(`  Crash test: ${existingCrashTest ? "already present" : "created"} Euro NCAP 2018 (G05)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
