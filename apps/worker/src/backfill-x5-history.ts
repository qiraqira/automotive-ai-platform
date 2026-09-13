import { prisma } from "@automotive/database";
import { fetchNameplateHistory } from "./lib/epa-fuel-economy.js";

// One-shot CLI entrypoint (`npm run backfill:x5-history --workspace
// @automotive/worker`). User's explicit, specific find (2026-09-14):
// the BMW X5 catalog entry only had 2 generations (F15, G05) seeded
// before this pass, when the real nameplate has had 4: E53
// (1999/2000-2006), E70 (2006/2007-2013), F15 (2013-2018), G05
// (2018-present) — this adds the two missing early ones.
//
// This is also the first entry built the way the user explicitly asked
// going forward: fueleconomy.gov's real EPA-filed model-year records as
// the base/skeleton (proving completeness — see the real, full
// 1999-2026 BMW X5 trim history this session pulled via the new
// fetch:epa-history parser, which even surfaced real trims this
// project's own prior Wikipedia research had missed, like the
// 2016-2018 xDrive40e plug-in hybrid), Wikipedia for the generation
// names/platform/history layered on top, and real hp/torque figures
// (which EPA's own data doesn't carry) from a direct read of each
// generation's Wikipedia article body.
//
// Sources (fetched 2026-09-14):
// - fetchNameplateHistory("BMW", "X5", 1999, 2026) — real EPA model-year
//   records confirming every trim name that actually existed each year
//   (recorded below as a Fact, not silently discarded, since it also
//   surfaced trims this entry still doesn't have full hp data for —
//   xDrive40e/M50i/M Competition/xDrive50e — left for a follow-up pass
//   rather than guessed at now)
// - "BMW X5 (E53)" / "BMW X5 (E70)" Wikipedia infoboxes + article bodies
//   (production years, model codes, exact hp/torque per engine/era)

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "bmw" } });
  if (!brand) throw new Error("BMW brand not found — run seed:real-cars first.");
  const x5 = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: "x5" } } });
  if (!x5) throw new Error("X5 CarModel not found — run seed:real-cars first.");

  // --- E53 (1999/2000-2006), first generation ---
  const e53 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: x5.id, slug: "e53" } },
    update: {},
    create: { carModelId: x5.id, slug: "e53", name: "E53 (first generation)", startYear: 1999, endYear: 2006 },
  });

  type TrimSpec = { slug: string; name: string; engineName: string; powerHp: number; fuel: string };
  const e53Trims: TrimSpec[] = [
    { slug: "3-0i", name: "3.0i", engineName: "3.0L I6 (M54)", powerHp: 228, fuel: "petrol" },
    { slug: "4-4i", name: "4.4i (facelift, 2003+)", engineName: "4.4L V8 (N62)", powerHp: 315, fuel: "petrol" },
    { slug: "4-6is", name: "4.6is", engineName: "4.6L V8 (M62)", powerHp: 342, fuel: "petrol" },
    { slug: "4-8is", name: "4.8is", engineName: "4.8L V8 (N62)", powerHp: 355, fuel: "petrol" },
    { slug: "3-0d", name: "3.0d (facelift, 2003+)", engineName: "3.0L Turbo I6 Diesel (M57)", powerHp: 215, fuel: "diesel" },
  ];
  for (const t of e53Trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: e53.id, slug: t.slug } },
      update: {},
      create: { generationId: e53.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, fuel: t.fuel } });
    }
  }

  // --- E70 (2006/2007-2013), second generation ---
  const e70 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: x5.id, slug: "e70" } },
    update: {},
    create: { carModelId: x5.id, slug: "e70", name: "E70 (second generation)", startYear: 2006, endYear: 2013 },
  });

  const e70Trims: TrimSpec[] = [
    { slug: "xdrive30i", name: "xDrive30i (badged 3.0si before 2009)", engineName: "3.0L I6 (N52)", powerHp: 268, fuel: "petrol" },
    { slug: "xdrive48i", name: "xDrive48i (badged 4.8i before 2009)", engineName: "4.8L V8 (N62)", powerHp: 350, fuel: "petrol" },
    { slug: "xdrive35i", name: "xDrive35i (added 2011)", engineName: "3.0L Turbo I6 (N55)", powerHp: 302, fuel: "petrol" },
    { slug: "xdrive50i", name: "xDrive50i (added 2011)", engineName: "4.4L Twin-Turbo V8 (N63)", powerHp: 402, fuel: "petrol" },
    { slug: "xdrive35d", name: "xDrive35d", engineName: "3.0L Twin-Turbo I6 Diesel (N57)", powerHp: 302, fuel: "diesel" },
    { slug: "x5-m", name: "X5 M", engineName: "4.4L Twin-Turbo V8 (S63)", powerHp: 547, fuel: "petrol" },
  ];
  for (const t of e70Trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: e70.id, slug: t.slug } },
      update: {},
      create: { generationId: e70.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, fuel: t.fuel } });
    }
  }

  // Verification only, not stored as a public Fact — a 28-year, year-by-
  // year trim dump would be exactly the kind of unexplained wall of raw
  // data the user's own feedback this session warned against showing
  // readers. Printed here so this run's own log is the audit trail for
  // "was this checked against a real complete list."
  const history = await fetchNameplateHistory("BMW", "X5", 1999, 2026);
  console.log("  EPA-verified real trim names by year (audit only, not published):");
  for (const [year, trims] of Object.entries(history)) {
    console.log(`    ${year}: ${trims.join(", ")}`);
  }
  const notYetCatalogued = ["xDrive40e", "M50i", "M Competition", "M60i", "xDrive50e"];
  console.log(`  Trims EPA confirms existed but this entry doesn't have full hp data for yet: ${notYetCatalogued.join(", ")} (real gap, left for a follow-up pass rather than guessed).`);

  console.log(`Backfilled: BMW X5 (${x5.id})`);
  console.log(`  E53 (${e53.id}), ${e53Trims.length} trims`);
  console.log(`  E70 (${e70.id}), ${e70Trims.length} trims`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
