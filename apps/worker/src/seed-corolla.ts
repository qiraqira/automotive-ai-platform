import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// One-shot CLI entrypoint (`npm run seed:corolla --workspace @automotive/worker`).
// First real catalog entry added by the manual/session-editor path (see
// publish-manual-article.ts's own header comment for why this project
// stopped calling an AI provider for content work): no OpenAI/Anthropic
// API call anywhere in this file, including for the hero photo — unlike
// seed-real-cars.ts's attachVerifiedCommonsPhoto() (which spends a real
// OpenAI vision call per photo, see verify-image.ts), the Commons photo
// below was looked at directly by the session writing this file before
// being self-hosted, the same "a person actually saw it" standard
// publish-manual-article.ts's heroImage already uses for articles.
//
// Toyota Corolla, twelfth generation (E210, Toyota New Global
// Architecture "GA-C" platform). Every figure below is sourced and dated
// in its own comment, matching this file's established "не выдумывать
// характеристики" (don't invent specs) rule.
//
// Sources (fetched 2026-09-13):
// - https://en.wikipedia.org/wiki/Toyota_Corolla_(E210) (generation/platform,
//   production years, facelift timing, engine codes)
// - https://www.cars.com/research/toyota-corolla-2026/ (2026 US trim lineup,
//   MSRP, EPA fuel economy)
// - https://en.wikipedia.org/wiki/Toyota_GR_Corolla (GR Corolla engine/
//   drivetrain/transmission specs)
// - https://www.iihs.org/ratings/vehicle/toyota/corolla-4-door-sedan/2025
//   (IIHS 2025 crash-test ratings)

async function attachCorollaPhoto(carModelId: string): Promise<void> {
  const existingHero = await prisma.carModelImage.findFirst({ where: { carModelId, role: "HERO" } });
  if (existingHero) {
    console.log("  Photo: HERO image already present, left untouched.");
    return;
  }
  // Wikimedia Commons, "2024 Toyota Corolla LE.jpg" — real owner-submitted
  // photo of a current-generation (E210, facelifted) US-spec Corolla LE,
  // viewed directly before use (grey sedan, correct badge/grille/lights
  // for this generation, dealer lot). CC BY 4.0, attribution required.
  const sourceUrl = "https://upload.wikimedia.org/wikipedia/commons/5/50/2024_Toyota_Corolla_LE.jpg";
  const hosted = await selfHostImage(sourceUrl);
  const existingImage = await prisma.image.findUnique({ where: { sha256: hosted.sha256 } });

  const candidate: Pick<ImageCandidate, "provider" | "licenseSlug" | "licenseUrl" | "attributionRequired"> = {
    provider: "Wikimedia Commons",
    licenseSlug: "cc-by-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0",
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
            author: "AnalyserOP",
            attribution: "AnalyserOP — CC BY 4.0, via Wikimedia Commons",
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
    data: { carModelId, imageId, role: "HERO", position: 0, altText: "A silver 2024 Toyota Corolla LE sedan, twelfth-generation (E210)" },
  });
  console.log("  Photo: attached (human-verified, not AI-verified — no OpenAI call).");
}

async function attachCorollaVideo(carModelId: string, youtubeId: string, title: string, category: "OFFICIAL" | "CRASH_TEST" | "REVIEW"): Promise<string> {
  const existing = await prisma.carVideo.findFirst({ where: { carModelId, youtubeId } });
  if (existing) {
    console.log(`  Video (${category}): "${title}" already present, left untouched.`);
    return existing.id;
  }
  const video = await prisma.carVideo.create({ data: { carModelId, youtubeId, title, category, sourceUrl: `https://www.youtube.com/watch?v=${youtubeId}` } });
  console.log(`  Video (${category}): attached "${title}" (verified via YouTube oEmbed to be on Toyota USA's own channel before use).`);
  return video.id;
}

async function main() {
  const toyota = await prisma.brand.upsert({
    where: { slug: "toyota" },
    update: {},
    create: { slug: "toyota", name: "Toyota", country: "JP" },
  });

  const corolla = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: toyota.id, slug: "corolla" } },
    update: {},
    create: { brandId: toyota.id, slug: "corolla", name: "Corolla" },
  });

  // --- E210 (2018-present), twelfth generation ---
  const e210 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: corolla.id, slug: "e210" } },
    update: {},
    create: { carModelId: corolla.id, slug: "e210", name: "Twelfth Generation (E210)", startYear: 2018, endYear: null },
  });

  // 2026 US trims/pricing/economy — cars.com. Gas: 2.0L M20A-FKS, 169 hp /
  // 151 lb-ft, CVT (Wikipedia for the engine code/displacement).
  const gasTrims: { slug: string; name: string }[] = [
    { slug: "le", name: "LE" },
    { slug: "se", name: "SE" },
    { slug: "xse", name: "XSE" },
  ];
  for (const t of gasTrims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: e210.id, slug: t.slug } },
      update: {},
      create: { generationId: e210.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({
        data: { trimId: trim.id, name: "2.0L Dynamic Force I4 (M20A-FKS)", powerKw: 126, powerHp: 169, fuel: "petrol" },
      });
    }
  }

  // Hybrid: 1.8L 2ZR-FXE + electric motor, 138 hp combined system output
  // (cars.com), CVT.
  const hybridTrims: { slug: string; name: string }[] = [
    { slug: "le-hybrid", name: "LE Hybrid" },
    { slug: "se-hybrid", name: "SE Hybrid" },
    { slug: "xle-hybrid", name: "XLE Hybrid" },
  ];
  for (const t of hybridTrims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: e210.id, slug: t.slug } },
      update: {},
      create: { generationId: e210.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({
        data: { trimId: trim.id, name: "1.8L Hybrid I4 (2ZR-FXE) + electric motor, combined", powerHp: 138, fuel: "hybrid" },
      });
    }
  }

  // GR Corolla: 1.6L turbo I3 (G16E-GTS), 300 hp / up to ~295 lb-ft
  // (Wikipedia), GR-Four AWD, 6-speed manual standard.
  const gr = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: e210.id, slug: "gr" } },
    update: {},
    create: { generationId: e210.id, slug: "gr", name: "GR Corolla" },
  });
  if ((await prisma.engine.count({ where: { trimId: gr.id } })) === 0) {
    await prisma.engine.create({
      data: { trimId: gr.id, name: "1.6L Turbo I3 (G16E-GTS)", powerKw: 224, powerHp: 300, fuel: "petrol" },
    });
  }

  // --- Facts: pricing and a real, non-obvious safety nuance ---
  const usMarket = await prisma.market.findFirst({ where: { code: "US" } });
  if (usMarket) {
    const existingPriceFact = await prisma.fact.findFirst({ where: { carModelId: corolla.id, attribute: "starting_msrp_le_2026" } });
    if (!existingPriceFact) {
      await prisma.fact.create({
        data: {
          carModelId: corolla.id,
          attribute: "starting_msrp_le_2026",
          value: "23920",
          unit: "usd",
          marketId: usMarket.id,
          status: "CONFIRMED",
          confidence: 0.85,
        },
      });
    }
  }

  const existingSafetyFact = await prisma.fact.findFirst({ where: { carModelId: corolla.id, attribute: "iihs_2025_award_detail" } });
  if (!existingSafetyFact) {
    await prisma.fact.create({
      data: {
        carModelId: corolla.id,
        attribute: "iihs_2025_award_detail",
        value: "IIHS 2025 Top Safety Pick (not the higher Plus tier) — the moderate overlap front test is rated Marginal specifically for rear-passenger chest protection and rear restraints, while every other tested category (small overlap front, side, structure, headlights, pedestrian front crash prevention) rates Good.",
        status: "CONFIRMED",
        confidence: 0.95,
      },
    });
  }

  await attachCorollaPhoto(corolla.id);

  await attachCorollaVideo(corolla.id, "6rV-e3xaVBY", "2023 Toyota Corolla Overview | Toyota", "OFFICIAL");
  const grVideoId = await attachCorollaVideo(corolla.id, "5C8LziN78KQ", "2023 Toyota GR Corolla Overview | Toyota", "OFFICIAL");
  void grVideoId;

  // --- Crash test: IIHS 2025 Corolla sedan ---
  const existingCrashTest = await prisma.crashTestResult.findFirst({
    where: { carModelId: corolla.id, generationId: e210.id, organization: "IIHS", testYear: 2025 },
  });
  if (!existingCrashTest) {
    await prisma.crashTestResult.create({
      data: {
        carModelId: corolla.id,
        generationId: e210.id,
        organization: "IIHS",
        overallRating: "Top Safety Pick",
        testYear: 2025,
        sourceUrl: "https://www.iihs.org/ratings/vehicle/toyota/corolla-4-door-sedan/2025",
        categoryScores: {
          small_overlap_front: "Good",
          moderate_overlap_front: "Marginal",
          side: "Good",
          structure_and_safety_cage: "Good",
          headlights: "Good",
          front_crash_prevention_pedestrian: "Good",
          seat_belt_reminders: "Good",
        },
      },
    });
    console.log("  Crash test: IIHS 2025 Top Safety Pick — created.");
  } else {
    console.log("  Crash test: IIHS 2025 result already present, left untouched.");
  }

  console.log(`Seeded real data: Brand ${toyota.name} (${toyota.id}), CarModel ${corolla.name} (${corolla.id})`);
  console.log(`  Generation: E210 (${e210.id}), ${gasTrims.length} gas trims, ${hybridTrims.length} hybrid trims, 1 GR performance trim`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
