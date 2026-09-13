import { prisma } from "@automotive/database";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

// One-shot CLI entrypoint (`npm run seed:charger --workspace @automotive/worker`).
// Seventh catalog entry via the manual/session-editor path, third built
// with this session's new fetch:infobox parser.
//
// Dodge Charger (2024-present, "LB" platform generation) — genuinely
// unusual among this catalog's entries: a brand-new nameplate generation
// that replaces BOTH the previous four-door Charger sedan and the
// two-door Challenger coupe at once, launched electric-only (Charger
// Daytona) with a twin-turbo gas inline-6 "Sixpack" variant arriving
// later on a staggered schedule — not yet fully on sale as of this
// entry, and with no IIHS rating at all yet (too new).
//
// Sources (fetched 2026-09-13):
// - "Dodge Charger (2024)" Wikipedia infobox via fetch:infobox
//   (production start, platform, assembly, battery capacity)
// - https://en.wikipedia.org/wiki/Dodge_Charger_(2024) article body
//   (exact hp/torque/range for Daytona R/T and Scat Pack; exact hp/
//   torque for Sixpack R/T and Scat Pack; exact availability timing;
//   confirms this replaces both the previous Charger sedan and
//   Challenger coupe)
// - https://www.cars.com/research/dodge-charger-2026/ (2026 US Sixpack
//   trim pricing across 2-door/4-door body styles; Daytona base price)
// - IIHS: no rating exists yet for this generation as of this session
//   (every plausible URL slug tried returned no page) — recorded as a
//   Fact rather than a CrashTestResult row, since there's nothing to
//   attach a real rating to.

async function main() {
  const dodge = await prisma.brand.upsert({
    where: { slug: "dodge" },
    update: {},
    create: { slug: "dodge", name: "Dodge", country: "US" },
  });

  const charger = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: dodge.id, slug: "charger" } },
    update: {},
    create: { brandId: dodge.id, slug: "charger", name: "Charger" },
  });

  const gen = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: charger.id, slug: "2024-lb" } },
    update: {},
    create: { carModelId: charger.id, slug: "2024-lb", name: "2024 Charger (LB platform)", startYear: 2024, endYear: null },
  });

  type TrimSpec = { slug: string; name: string; engineName: string; powerHp: number; fuel: string };
  const trims: TrimSpec[] = [
    { slug: "daytona-rt", name: "Daytona R/T", engineName: "Dual electric motors, AWD, 100.5 kWh battery", powerHp: 496, fuel: "electric" },
    { slug: "daytona-scat-pack", name: "Daytona Scat Pack", engineName: "Dual electric motors, AWD, 100.5 kWh battery", powerHp: 670, fuel: "electric" },
    { slug: "sixpack-rt", name: "Sixpack R/T (gas, arriving H1 2026)", engineName: "3.0L Twin-Turbo I6 (Hurricane)", powerHp: 420, fuel: "petrol" },
    { slug: "sixpack-scat-pack", name: "Sixpack Scat Pack (gas, arriving late 2025)", engineName: "3.0L Twin-Turbo I6 (Hurricane)", powerHp: 550, fuel: "petrol" },
  ];
  for (const t of trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: gen.id, slug: t.slug } },
      update: {},
      create: { generationId: gen.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, fuel: t.fuel } });
    }
  }

  // Battery/range rows for the two electric trims specifically.
  const daytonaRt = await prisma.trim.findFirst({ where: { generationId: gen.id, slug: "daytona-rt" } });
  if (daytonaRt && !(await prisma.battery.findFirst({ where: { trimId: daytonaRt.id } }))) {
    await prisma.battery.create({ data: { trimId: daytonaRt.id, capacityKwh: 100.5, rangeMiles: 317 } });
  }
  const daytonaScatPack = await prisma.trim.findFirst({ where: { generationId: gen.id, slug: "daytona-scat-pack" } });
  if (daytonaScatPack && !(await prisma.battery.findFirst({ where: { trimId: daytonaScatPack.id } }))) {
    await prisma.battery.create({ data: { trimId: daytonaScatPack.id, capacityKwh: 100.5, rangeMiles: 260 } });
  }

  // --- Facts ---
  const usMarket = await prisma.market.findFirst({ where: { code: "US" } });
  if (usMarket) {
    const existingPriceFact = await prisma.fact.findFirst({ where: { carModelId: charger.id, attribute: "starting_msrp_daytona_2026" } });
    if (!existingPriceFact) {
      await prisma.fact.create({
        data: {
          carModelId: charger.id,
          attribute: "starting_msrp_daytona_2026",
          value: "59995",
          unit: "usd",
          marketId: usMarket.id,
          status: "CONFIRMED",
          confidence: 0.8,
        },
      });
    }
  }

  const existingConsolidationFact = await prisma.fact.findFirst({ where: { carModelId: charger.id, attribute: "replaces_two_nameplates" } });
  if (!existingConsolidationFact) {
    await prisma.fact.create({
      data: {
        carModelId: charger.id,
        attribute: "replaces_two_nameplates",
        value:
          "This 2024-present Charger generation replaces both the previous four-door Dodge Charger sedan and the two-door Dodge Challenger coupe at once — Dodge consolidated two separate nameplates (both of which offered supercharged V8 Hellcat variants) into a single new model line, launched electric-only before a gas twin-turbo inline-6 option followed on a staggered schedule.",
        status: "CONFIRMED",
        confidence: 0.9,
      },
    });
  }

  const existingNoIihsFact = await prisma.fact.findFirst({ where: { carModelId: charger.id, attribute: "no_iihs_rating_yet" } });
  if (!existingNoIihsFact) {
    await prisma.fact.create({
      data: {
        carModelId: charger.id,
        attribute: "no_iihs_rating_yet",
        value:
          "No IIHS crash-test rating exists for this generation as of this entry — genuinely too new for the agency to have tested it yet, unlike the Ford Mustang and Chevrolet Camaro, whose own published ratings are years old but at least exist.",
        status: "CONFIRMED",
        confidence: 0.85,
      },
    });
  }

  // --- Photos: Wikimedia Commons, "2024 Dodge Charger Daytona Scat Pack
  // in Redeye" front/rear pair — both viewed directly before use: a
  // genuine Daytona Scat Pack with the real "DAYTONA" rear badge and
  // correct front fascia for this generation. CC BY-SA 4.0. ---
  await attachCarModelPhoto(
    charger.id,
    {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/6/60/2024_Dodge_Charger_Daytona_Scat_Pack_in_Redeye%2C_front_left%2C_2026-08-30.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc-by-sa-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attributionRequired: true,
      artist: "Elise240SX",
      altText: "A red 2024 Dodge Charger Daytona Scat Pack, front three-quarter view",
    },
    "HERO",
    0,
  );
  await attachCarModelPhoto(
    charger.id,
    {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/0/00/2024_Dodge_Charger_Daytona_Scat_Pack_in_Redeye%2C_rear_left%2C_2026-08-30.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc-by-sa-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attributionRequired: true,
      artist: "Elise240SX",
      altText: "A red 2024 Dodge Charger Daytona Scat Pack, rear three-quarter view showing the Daytona badge",
    },
    "GALLERY",
    1,
  );

  console.log(`Seeded real data: Brand ${dodge.name} (${dodge.id}), CarModel ${charger.name} (${charger.id})`);
  console.log(`  Generation: 2024 LB (${gen.id}), ${trims.length} trims`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
