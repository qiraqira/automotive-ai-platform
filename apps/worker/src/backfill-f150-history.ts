import { prisma } from "@automotive/database";

// One-shot CLI entrypoint (`npm run backfill:f150-history --workspace
// @automotive/worker`). Third model taken toward the X5 completeness
// standard. Built with almost no new research calls, per the user's own
// resource-consciousness ask: four of five added generations came
// straight from the research-nameplate.ts report run earlier this
// session (its Wikipedia-infobox data, not re-fetched); the fifth
// (eleventh generation, 2004-2008) was a single cheap fetch:infobox
// call after noticing its predecessor/successor chain referenced a
// generation the original 15-result search hadn't surfaced — closing a
// real gap rather than leaving a silent hole in the sequence, for the
// cost of one more parser call, not a WebFetch.
//
// Real, honest scope decision: engine NAMES for the four missing older
// generations (9th/10th/12th/13th) come straight from each generation's
// own Wikipedia infobox `engine` field, but NOT hp/torque — the
// infobox doesn't carry that (same known limitation already documented
// in wikipedia-car.ts's own header), and getting exact period-correct
// hp for a dozen-plus 1990s-2010s engines would mean several more
// WebFetch calls this pass deliberately skips to keep this cheap. Power
// is left unset (renders as "—" in the real spec table) rather than
// guessed — a real, visible gap to close in a later pass, not a
// fabricated number.
//
// Source: this session's own `npm run research:nameplate -- Ford F-150
// 1990 2026` run (2026-09-14), specifically the "Ford F-Series (ninth/
// tenth/twelfth/thirteenth generation)" Wikipedia infobox results.
// Confirms a real, interesting structural fact too: Ford's own Wikipedia
// coverage organizes F-150 generations under the shared "Ford F-Series"
// umbrella nameplate (F-150/F-250/F-350 together), not per-F-150 articles
// — this catalog still slots them under the site's own "f-150" CarModel,
// since that's the real retail nameplate this project's catalog is
// organized around.

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "ford" } });
  if (!brand) throw new Error("Ford brand not found.");
  const f150 = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: "f-150" } } });
  if (!f150) throw new Error("F-150 CarModel not found.");

  type GenSpec = { slug: string; name: string; startYear: number; endYear: number | null; engines: string[] };
  const gens: GenSpec[] = [
    {
      slug: "9th-gen",
      name: "F-Series Ninth Generation",
      startYear: 1992,
      endYear: 1997,
      engines: [
        "4.9L Truck Six I6",
        "5.0L Windsor V8",
        "5.8L Windsor V8",
        "7.5L 385-series V8",
        "7.3L IDI Diesel V8 (1992-1994)",
        "7.3L IDI Turbo Diesel V8 (1993-1994)",
        "7.3L Power Stroke Turbodiesel V8 (1994.5-1997)",
      ],
    },
    {
      slug: "10th-gen",
      name: "F-Series Tenth Generation",
      startYear: 1997,
      endYear: 2004,
      engines: [], // Wikipedia's own infobox for this generation didn't list an engine field this session's report captured
    },
    {
      slug: "11th-gen",
      name: "F-Series Eleventh Generation",
      startYear: 2004,
      endYear: 2008,
      engines: ["4.2L (256 CID) Essex V6", "4.6L (281 CID) Triton V8", "5.4L (330 CID) Triton V8"],
    },
    {
      slug: "12th-gen",
      name: "F-Series Twelfth Generation",
      startYear: 2009,
      endYear: 2014,
      engines: [
        "4.6L (281 CID) 2V Modular V8",
        "4.6L (281 CID) 3V Modular V8",
        "5.4L (330 CID) 3V Modular V8",
        "3.5L EcoBoost V6",
        "3.7L Ti-VCT V6",
        "5.0L (302 CID) Coyote V8",
        "6.2L (379 CID) 2V Boss V8",
      ],
    },
    {
      slug: "13th-gen",
      name: "F-Series Thirteenth Generation",
      startYear: 2015,
      endYear: 2020,
      engines: ["3.3L Cyclone V6", "3.5L Cyclone V6", "2.7L EcoBoost Nano Twin-Turbo V6", "3.5L EcoBoost Twin-Turbo V6", "5.0L Coyote V8", "3.0L Power Stroke Turbo Diesel V6"],
    },
  ];

  for (const gen of gens) {
    const generation = await prisma.generation.upsert({
      where: { carModelId_slug: { carModelId: f150.id, slug: gen.slug } },
      update: {},
      create: { carModelId: f150.id, slug: gen.slug, name: gen.name, startYear: gen.startYear, endYear: gen.endYear },
    });
    for (const engineName of gen.engines) {
      const trimSlug = engineName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const trim = await prisma.trim.upsert({
        where: { generationId_slug: { generationId: generation.id, slug: trimSlug } },
        update: {},
        create: { generationId: generation.id, slug: trimSlug, name: engineName },
      });
      if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
        const fuel = /diesel/i.test(engineName) ? "diesel" : "petrol";
        await prisma.engine.create({ data: { trimId: trim.id, name: engineName, fuel } });
      }
    }
    console.log(`  ${gen.name} (${generation.id}): ${gen.engines.length} engine option(s), power not yet sourced.`);
  }

  const existingFact = await prisma.fact.findFirst({ where: { carModelId: f150.id, attribute: "wikipedia_organizes_under_f_series" } });
  if (!existingFact) {
    await prisma.fact.create({
      data: {
        carModelId: f150.id,
        attribute: "wikipedia_organizes_under_f_series",
        value:
          "Wikipedia documents F-150 generation history under the shared \"Ford F-Series\" nameplate umbrella (covering the F-150 alongside the F-250/F-350 Super Duty trucks), not as standalone \"F-150\" generation articles — this catalog entry still organizes its own generations under the retail F-150 name specifically, since that's the model this site's catalog is structured around.",
        status: "CONFIRMED",
        confidence: 0.85,
      },
    });
  }

  console.log(`Backfilled: Ford F-150 (${f150.id}), 4 generations, engine names only (power figures deliberately not fetched this pass).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
