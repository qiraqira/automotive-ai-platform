import { prisma } from "@automotive/database";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

// One-shot CLI entrypoint (`npm run seed:camaro --workspace @automotive/worker`).
// Sixth catalog entry via the manual/session-editor path (see
// seed-corolla.ts's header for the full rationale), built via this
// session's new deterministic parsers (fetch:infobox, fetch:iihs)
// instead of WebFetch for the backbone facts.
//
// Chevrolet Camaro, sixth and — as of December 2023 — final generation.
// Genuinely discontinued, not just "current generation superseded by a
// newer one": no seventh-generation Camaro exists, which is itself the
// single most newsworthy real fact about this nameplate right now.
//
// Sources (fetched 2026-09-13):
// - "Chevrolet Camaro (sixth generation)" Wikipedia infobox via this
//   session's fetch:infobox parser (production years, platform,
//   predecessor) — this specific page's engine/weight infobox fields
//   were malformed/empty (a real limitation of the generic infobox
//   parser noted in lib/wikipedia-car.ts's own comments: some pages'
//   multi-column spec tables don't map cleanly to flat key=value pairs),
//   so exact engine figures came from a direct read of the article body
//   instead, not invented to fill the gap.
// - https://en.wikipedia.org/wiki/Chevrolet_Camaro_(sixth_generation)
//   article body (engine hp/torque figures, exact production-end date,
//   final Collector's Edition run numbers)
// - IIHS via this session's fetch:iihs parser against
//   https://www.iihs.org/ratings/vehicle/chevrolet/camaro-2-door-coupe/2019

async function main() {
  const chevrolet = await prisma.brand.upsert({
    where: { slug: "chevrolet" },
    update: {},
    create: { slug: "chevrolet", name: "Chevrolet", country: "US" },
  });

  const camaro = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: chevrolet.id, slug: "camaro" } },
    update: {},
    create: { brandId: chevrolet.id, slug: "camaro", name: "Camaro" },
  });

  // --- Sixth generation (2016-2024) — the final one. ---
  const gen6 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: camaro.id, slug: "6th-gen" } },
    update: {},
    create: { carModelId: camaro.id, slug: "6th-gen", name: "Sixth Generation (final)", startYear: 2016, endYear: 2024 },
  });

  type TrimSpec = { slug: string; name: string; engineName: string; powerHp: number; fuel: string };
  const trims: TrimSpec[] = [
    { slug: "turbo", name: "1LT/2LT (Turbo)", engineName: "2.0L Turbo I4 (LTG Ecotec)", powerHp: 275, fuel: "petrol" },
    { slug: "v6", name: "1LT/2LT (V6)", engineName: "3.6L V6 (LGX)", powerHp: 335, fuel: "petrol" },
    { slug: "ss", name: "SS", engineName: "6.2L V8 (LT1)", powerHp: 455, fuel: "petrol" },
    { slug: "zl1", name: "ZL1", engineName: "6.2L Supercharged V8 (LT4)", powerHp: 650, fuel: "petrol" },
  ];
  for (const t of trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: gen6.id, slug: t.slug } },
      update: {},
      create: { generationId: gen6.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, fuel: t.fuel } });
    }
  }

  // --- Facts: the discontinuation itself is the real story here. ---
  const existingDiscontinuedFact = await prisma.fact.findFirst({ where: { carModelId: camaro.id, attribute: "production_ended" } });
  if (!existingDiscontinuedFact) {
    await prisma.fact.create({
      data: {
        carModelId: camaro.id,
        attribute: "production_ended",
        value:
          "Production of the sixth-generation Camaro ended December 14, 2023, with no seventh-generation replacement — the Camaro nameplate is currently out of production entirely, not merely between generations. The final run was a 2024 Collector's Edition: 350 ZL1 units total (300 for the US, 30 for Canada, 20 for Mexico), with distinctive badging and unique exterior stripes.",
        status: "CONFIRMED",
        confidence: 0.92,
      },
    });
  }

  const existingIihsGapFact = await prisma.fact.findFirst({ where: { carModelId: camaro.id, attribute: "iihs_rating_is_stale" } });
  if (!existingIihsGapFact) {
    await prisma.fact.create({
      data: {
        carModelId: camaro.id,
        attribute: "iihs_rating_is_stale",
        value:
          "IIHS's own published Camaro rating is based on 2016 model-year testing under IIHS's original (not updated) moderate overlap front and side protocols, with only the driver-side small overlap front test completed — never re-tested since, and never rated for headlights or front crash prevention at all. Roof strength rates Acceptable and LATCH ease of use rates Marginal; no Top Safety Pick award of any kind is shown. Even more dated than the same-era Ford Mustang's own IIHS listing on this site.",
        status: "CONFIRMED",
        confidence: 0.9,
      },
    });
  }

  // --- Photos: Wikimedia Commons, both viewed directly before use. HERO
  // is a stock-color silver SS convertible; GALLERY is a genuine SS
  // coupe with an aftermarket wrap and wheels — still a real, correctly
  // identifiable sixth-gen car, noted as modified in its alt text so a
  // reader isn't misled about factory appearance. ---
  await attachCarModelPhoto(
    camaro.id,
    {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/3/38/2019_Chevrolet_Camaro_SS_%2844586%29.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc-by-sa-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attributionRequired: true,
      artist: "Calreyn88",
      altText: "A silver 2019 Chevrolet Camaro SS convertible, sixth generation, rear three-quarter view",
    },
    "HERO",
    0,
  );
  await attachCarModelPhoto(
    camaro.id,
    {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/f/f4/2019_Chevrolet_Camaro_SS.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc-by-sa-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attributionRequired: true,
      artist: "Calreyn88",
      altText: "A 2019 Chevrolet Camaro SS coupe with an aftermarket black-and-yellow wrap, front view",
    },
    "GALLERY",
    1,
  );

  console.log(`Seeded real data: Brand ${chevrolet.name} (${chevrolet.id}), CarModel ${camaro.name} (${camaro.id})`);
  console.log(`  Generation: Sixth Generation, final (${gen6.id}), ${trims.length} trims`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
