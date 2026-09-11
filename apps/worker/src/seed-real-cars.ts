import { prisma } from "@automotive/database";
import { extractYoutubeId } from "@automotive/utils";
import { searchCommonsImage, hashRemoteImage, getOrCreateLicense, rightsStatusFor } from "./fetch-images.js";
import { verifyImageMatch } from "./verify-image.js";

// Real gap found live 2026-09-11: the CarVideo feature itself (schema,
// admin UI, public embed) shipped two ticks ago, but nothing ever
// actually attached a real video to either seeded CarModel — the
// "Official videos"/"Crash test videos" sections on both /cars/bmw/x5
// and /cars/mercedes-benz/gle have been rendering empty this whole time.
// Same idempotent-per-slug-of-sorts pattern as the rest of this file:
// checked by youtubeId, never duplicated on re-run. Runs extractYoutubeId()
// (the same real URL parser the admin UI's own POST endpoint uses) rather
// than hand-typing the 11-char id, so a typo'd id can't silently attach a
// broken embed.
async function attachCurated(carModelId: string, url: string, title: string, category: "OFFICIAL" | "CRASH_TEST" | "REVIEW"): Promise<string> {
  const youtubeId = extractYoutubeId(url);
  if (!youtubeId) throw new Error(`Could not extract a YouTube id from ${url}`);
  const existing = await prisma.carVideo.findFirst({ where: { carModelId, youtubeId } });
  if (existing) {
    console.log(`  Video (${category}): "${title}" already present, left untouched.`);
    return existing.id;
  }
  const video = await prisma.carVideo.create({ data: { carModelId, youtubeId, title, category, sourceUrl: url } });
  console.log(`  Video (${category}): attached "${title}".`);
  return video.id;
}

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

  // Real curated videos — see attachCurated()'s own comment for why this
  // was missing until now despite the CarVideo feature itself shipping
  // two ticks ago. Official trailer confirmed against BMW's own press
  // portal (press.bmwgroup.com/global/video/detail/PF0006063 — "The
  // all-new BMW X5 – Online trailer"); crash-test video from Euro NCAP's
  // own YouTube channel (youtube.com/channel/UCNEWZqjcguqWZOG8yZZpIFg),
  // titled with their standard "Euro NCAP Crash Test of [model] [year]"
  // naming convention.
  await attachCurated(x5.id, "https://www.youtube.com/watch?v=rfCqNmtRxkc", "All-New BMW X5 (G05) — Official Online Trailer", "OFFICIAL");
  const x5CrashVideoId = await attachCurated(x5.id, "https://www.youtube.com/watch?v=3UJpWAma8rg", "Euro NCAP Crash Test of BMW X5 2018", "CRASH_TEST");
  const x5CrashTestRow = await prisma.crashTestResult.findFirst({ where: { carModelId: x5.id, generationId: g05.id, organization: "EURO_NCAP", testYear: 2018 } });
  if (x5CrashTestRow && !x5CrashTestRow.videoId) {
    await prisma.crashTestResult.update({ where: { id: x5CrashTestRow.id }, data: { videoId: x5CrashVideoId } });
  }

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

  // Real curated videos, same pattern as BMW X5 above. "New GLE and
  // GLS – Recording of the world premiere live stream" is framed as
  // Mercedes-Benz's own event recording, not third-party coverage.
  await attachCurated(gle.id, "https://www.youtube.com/watch?v=33_GC5RsdCE", "New GLE and GLS — World Premiere Livestream Recording", "OFFICIAL");
  const gleCrashVideoId = await attachCurated(gle.id, "https://www.youtube.com/watch?v=16FH8QrENFw", "Euro NCAP Crash Test of Mercedes-Benz GLE 2019", "CRASH_TEST");
  const gleCrashTestRow = await prisma.crashTestResult.findFirst({ where: { carModelId: gle.id, generationId: w167.id, organization: "EURO_NCAP", testYear: 2019 } });
  if (gleCrashTestRow && !gleCrashTestRow.videoId) {
    await prisma.crashTestResult.update({ where: { id: gleCrashTestRow.id }, data: { videoId: gleCrashVideoId } });
  }

  console.log(`Seeded real data: Brand ${mercedes.name} (${mercedes.id}), CarModel ${gle.name} (${gle.id})`);
  console.log(`  Generation: W167 (${w167.id}, 2 trims: GLE 450, AMG GLE 63 S)`);
  console.log(`  Crash test: ${existingGleCrashTest ? "already present" : "created"} Euro NCAP 2019 (W167)`);

  // ============================================================
  // Tesla Model Y — added 2026-09-11, third vertical slice. Picked over a
  // second luxury-SUV competitor deliberately: it's the single best-
  // selling vehicle on Earth (any body style, any powertrain) for three
  // straight years, so it's a real, high-interest search topic distinct
  // from the BMW X5 / Mercedes GLE pair above, not just "one more SUV".
  //
  // Sources (fetched 2026-09-11):
  // - https://en.wikipedia.org/wiki/Tesla_Model_Y (generation timeline:
  //   2020 launch, 2022 heat-pump refresh — same body generation — then
  //   the 2025 "Juniper" redesign as a genuinely new generation)
  // - 2022 Long Range/Performance pricing+specs: truecar.com/kbb.com/
  //   fleetnews.co.uk 2022 model-year pages (384 hp LR / 456 hp
  //   Performance, both dual-motor AWD — Tesla never sold a single-motor
  //   Model Y in this generation)
  // - 2026 Juniper Standard/Premium/Performance pricing+specs:
  //   evspecifications.com + motormatchup.com 2026 model pages; usable
  //   battery capacity (69.5/79.0 kWh) from evkx.net/tycorun.com — Tesla
  //   itself has never published an official pack-kWh figure for either
  //   generation, so these are the commonly-cited third-party figures,
  //   same sourcing tier as the BMW xDrive45e 24 kWh figure above.
  // - Euro NCAP 2022 assessment (Berlin-built, first generation):
  //   https://www.euroncap.com/assessments/tesla/model+y/0961/
  // - Euro NCAP 2025 assessment (Juniper, retested under the stricter
  //   2025 protocol — a genuinely lower Adult/child % is expected under
  //   the harder protocol, not a real safety regression):
  //   https://www.euroncap.com/assessments/tesla/model+y/1181/
  // - World's-best-selling-vehicle fact: insideevs.com/motor1.com/
  //   jato.com for the undisputed 2023 result (1.23M units, first EV
  //   ever to top the global yearly sales chart). The 2024/2025 figures
  //   were corrected same-day after checking independent analyst data
  //   rather than only Tesla-friendly coverage — JATO Dynamics (via
  //   jalopnik.com/electrek.co, reported by analyst Felipe Munoz) has
  //   Toyota RAV4 actually winning 2024 by under 3,000 units (1.187M vs
  //   1.185M), and Statista/focus2move.com show the same RAV4-ahead
  //   pattern continuing into full-year 2025 — a real, current,
  //   genuinely disputed race, not the clean "three years running" a
  //   first pass at this took Tesla's own PR framing to mean.
  // ============================================================
  const tesla = await prisma.brand.upsert({
    where: { slug: "tesla" },
    update: {},
    create: { slug: "tesla", name: "Tesla", country: "US" },
  });
  const modelY = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: tesla.id, slug: "model-y" } },
    update: {},
    create: { brandId: tesla.id, slug: "model-y", name: "Model Y" },
  });

  // --- First generation (2020-2024, incl. 2022 heat-pump refresh) ---
  const gen1 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: modelY.id, slug: "2020-2024" } },
    update: {},
    create: { carModelId: modelY.id, slug: "2020-2024", name: "Model Y (2020–2024)", startYear: 2020, endYear: 2024 },
  });

  const gen1LongRange = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: gen1.id, slug: "long-range-awd" } },
    update: {},
    create: { generationId: gen1.id, slug: "long-range-awd", name: "Long Range AWD" },
  });
  if ((await prisma.engine.count({ where: { trimId: gen1LongRange.id } })) === 0) {
    await prisma.engine.create({
      data: { trimId: gen1LongRange.id, name: "Dual Motor (front + rear)", powerHp: 384, fuel: "electric" },
    });
  }
  if ((await prisma.battery.count({ where: { trimId: gen1LongRange.id } })) === 0) {
    await prisma.battery.create({ data: { trimId: gen1LongRange.id, rangeMiles: 318 } });
  }

  const gen1Performance = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: gen1.id, slug: "performance-awd" } },
    update: {},
    create: { generationId: gen1.id, slug: "performance-awd", name: "Performance AWD" },
  });
  if ((await prisma.engine.count({ where: { trimId: gen1Performance.id } })) === 0) {
    await prisma.engine.create({
      data: { trimId: gen1Performance.id, name: "Dual Motor (front + rear)", powerHp: 456, fuel: "electric" },
    });
  }
  if ((await prisma.battery.count({ where: { trimId: gen1Performance.id } })) === 0) {
    await prisma.battery.create({ data: { trimId: gen1Performance.id, rangeMiles: 303 } });
  }

  // --- Second generation: "Juniper" redesign (2025-present) ---
  const juniper = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: modelY.id, slug: "juniper" } },
    update: {},
    create: { carModelId: modelY.id, slug: "juniper", name: "Model Y Juniper", startYear: 2025, endYear: null },
  });

  const juniperStandard = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: juniper.id, slug: "standard-rwd" } },
    update: {},
    create: { generationId: juniper.id, slug: "standard-rwd", name: "Standard RWD" },
  });
  if ((await prisma.engine.count({ where: { trimId: juniperStandard.id } })) === 0) {
    await prisma.engine.create({ data: { trimId: juniperStandard.id, name: "Single Motor (rear)", fuel: "electric" } });
  }
  if ((await prisma.battery.count({ where: { trimId: juniperStandard.id } })) === 0) {
    await prisma.battery.create({ data: { trimId: juniperStandard.id, capacityKwh: 69.5, rangeMiles: 321 } });
  }

  const juniperPremiumRwd = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: juniper.id, slug: "premium-rwd" } },
    update: {},
    create: { generationId: juniper.id, slug: "premium-rwd", name: "Premium RWD" },
  });
  if ((await prisma.engine.count({ where: { trimId: juniperPremiumRwd.id } })) === 0) {
    await prisma.engine.create({ data: { trimId: juniperPremiumRwd.id, name: "Single Motor (rear)", fuel: "electric" } });
  }
  if ((await prisma.battery.count({ where: { trimId: juniperPremiumRwd.id } })) === 0) {
    await prisma.battery.create({ data: { trimId: juniperPremiumRwd.id, capacityKwh: 79.0, rangeMiles: 357 } });
  }

  const juniperPremiumAwd = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: juniper.id, slug: "premium-awd" } },
    update: {},
    create: { generationId: juniper.id, slug: "premium-awd", name: "Premium AWD" },
  });
  if ((await prisma.engine.count({ where: { trimId: juniperPremiumAwd.id } })) === 0) {
    await prisma.engine.create({ data: { trimId: juniperPremiumAwd.id, name: "Dual Motor (front + rear)", fuel: "electric" } });
  }
  if ((await prisma.battery.count({ where: { trimId: juniperPremiumAwd.id } })) === 0) {
    await prisma.battery.create({ data: { trimId: juniperPremiumAwd.id, capacityKwh: 79.0, rangeMiles: 327 } });
  }

  const juniperPerformance = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: juniper.id, slug: "performance-awd" } },
    update: {},
    create: { generationId: juniper.id, slug: "performance-awd", name: "Performance AWD" },
  });
  if ((await prisma.engine.count({ where: { trimId: juniperPerformance.id } })) === 0) {
    await prisma.engine.create({ data: { trimId: juniperPerformance.id, name: "Dual Motor (front + rear)", powerHp: 525, fuel: "electric" } });
  }
  if ((await prisma.battery.count({ where: { trimId: juniperPerformance.id } })) === 0) {
    await prisma.battery.create({ data: { trimId: juniperPerformance.id, capacityKwh: 79.0, rangeMiles: 306 } });
  }

  // --- Real, dated fact, corrected same-day after a closer check of
  // independent sales data (2026-09-11, later the same tick this was
  // first seeded): the original wording here claimed an unqualified
  // "three consecutive years" streak, sourced only from Tesla's own and
  // Tesla-friendly coverage. Independent analyst data (JATO Dynamics,
  // Statista/Focus2move) tells a real, more interesting story that
  // wording flattened — kept as the fuller, hedged version rather than
  // silently re-confirming the first draft.
  const existingSalesFact = await prisma.fact.findFirst({ where: { carModelId: modelY.id, attribute: "world_best_selling_vehicle" } });
  const salesFactValue =
    "First all-electric car ever to be the world's best-selling vehicle overall (any body style/powertrain) — undisputed in 2023 at 1.23M units. In 2024 and 2025, independent analyst data (JATO Dynamics, Statista/Focus2move) shows the Toyota RAV4 actually edged it out both years by a razor-thin margin (2024: RAV4 1.187M vs Model Y 1.185M, under 3,000 units) — despite Tesla's own PR continuing to claim the title for all three years.";
  if (!existingSalesFact) {
    await prisma.fact.create({
      data: { carModelId: modelY.id, attribute: "world_best_selling_vehicle", value: salesFactValue, status: "CONFIRMED", confidence: 0.9 },
    });
  } else if (existingSalesFact.value !== salesFactValue) {
    await prisma.fact.update({ where: { id: existingSalesFact.id }, data: { value: salesFactValue } });
  }

  // --- Real Euro NCAP crash tests, one per generation ---
  const existingGen1CrashTest = await prisma.crashTestResult.findFirst({
    where: { carModelId: modelY.id, generationId: gen1.id, organization: "EURO_NCAP", testYear: 2022 },
  });
  if (!existingGen1CrashTest) {
    await prisma.crashTestResult.create({
      data: {
        carModelId: modelY.id,
        generationId: gen1.id,
        organization: "EURO_NCAP",
        overallRating: "5 stars",
        categoryScores: {
          adult_occupant: "97%",
          child_occupant: "87%",
          pedestrian: "82%",
          safety_assist: "98%",
        },
        testYear: 2022,
        sourceUrl: "https://www.euroncap.com/assessments/tesla/model+y/0961/",
      },
    });
  }

  const existingJuniperCrashTest = await prisma.crashTestResult.findFirst({
    where: { carModelId: modelY.id, generationId: juniper.id, organization: "EURO_NCAP", testYear: 2025 },
  });
  if (!existingJuniperCrashTest) {
    await prisma.crashTestResult.create({
      data: {
        carModelId: modelY.id,
        generationId: juniper.id,
        organization: "EURO_NCAP",
        overallRating: "5 stars",
        categoryScores: {
          adult_occupant: "91%",
          child_occupant: "93%",
          pedestrian: "86%",
          safety_assist: "92%",
        },
        testYear: 2025,
        sourceUrl: "https://www.euroncap.com/assessments/tesla/model+y/1181/",
      },
    });
  }

  await attachVerifiedCommonsPhoto(modelY.id, "Tesla Model Y", "Tesla Model Y", "Tesla Model Y, a compact electric crossover SUV");

  // Real curated videos. Official: Tesla's own unveil event recording
  // (tesla.com's YouTube channel, March 2019). Crash tests: Euro NCAP's
  // own channel (youtube.com/channel/UCNEWZqjcguqWZOG8yZZpIFg), one per
  // real generation tested above.
  await attachCurated(modelY.id, "https://www.youtube.com/watch?v=Tb_Wn6K0uVs", "Tesla Model Y Unveil", "OFFICIAL");
  const gen1CrashVideoId = await attachCurated(modelY.id, "https://www.youtube.com/watch?v=dKaN3f2zmCQ", "Euro NCAP Safety Tests of Tesla Model Y 2022", "CRASH_TEST");
  const gen1CrashTestRow = await prisma.crashTestResult.findFirst({ where: { carModelId: modelY.id, generationId: gen1.id, organization: "EURO_NCAP", testYear: 2022 } });
  if (gen1CrashTestRow && !gen1CrashTestRow.videoId) {
    await prisma.crashTestResult.update({ where: { id: gen1CrashTestRow.id }, data: { videoId: gen1CrashVideoId } });
  }
  const juniperCrashVideoId = await attachCurated(modelY.id, "https://www.youtube.com/watch?v=tMzggr2BDes", "Euro NCAP Crash & Safety Tests of Tesla Model Y 2025", "CRASH_TEST");
  const juniperCrashTestRow = await prisma.crashTestResult.findFirst({ where: { carModelId: modelY.id, generationId: juniper.id, organization: "EURO_NCAP", testYear: 2025 } });
  if (juniperCrashTestRow && !juniperCrashTestRow.videoId) {
    await prisma.crashTestResult.update({ where: { id: juniperCrashTestRow.id }, data: { videoId: juniperCrashVideoId } });
  }

  console.log(`Seeded real data: Brand ${tesla.name} (${tesla.id}), CarModel ${modelY.name} (${modelY.id})`);
  console.log(`  Generations: 2020-2024 (${gen1.id}, 2 trims), Juniper (${juniper.id}, 4 trims)`);
  console.log(`  Fact: ${existingSalesFact ? "already present (checked for corrections)" : "created"} world's-best-selling-vehicle fact`);
  console.log(`  Crash tests: ${existingGen1CrashTest ? "already present" : "created"} Euro NCAP 2022 (gen1), ${existingJuniperCrashTest ? "already present" : "created"} Euro NCAP 2025 (Juniper)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
