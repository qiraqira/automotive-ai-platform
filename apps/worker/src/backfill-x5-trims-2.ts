import { prisma } from "@automotive/database";

// One-shot CLI entrypoint (`npm run backfill:x5-trims-2 --workspace
// @automotive/worker`). Closes the 5-trim gap this session's own
// fetch:epa-history run flagged honestly rather than guessed at when
// backfill-x5-history.ts first ran: F15's xDrive40e plug-in hybrid, and
// G05's M50i (already present, verified matching), M Competition, M60i
// xDrive, and xDrive50e plug-in hybrid.
//
// Sources (fetched 2026-09-14):
// - https://en.wikipedia.org/wiki/BMW_X5_(F15) (xDrive40e hp/torque/
//   battery/range)
// - https://en.wikipedia.org/wiki/BMW_X5_(G05) (M Competition, xDrive50e
//   hp/torque/battery/range; M50i cross-checked, matches existing row)
// - BMW's own bmw-m.com model page + Edmunds + automobile-catalog.com,
//   cross-matching exactly on 523 hp / 553 lb-ft (M60i xDrive)

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "bmw" } });
  if (!brand) throw new Error("BMW brand not found.");
  const x5 = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: "x5" } } });
  if (!x5) throw new Error("X5 CarModel not found.");
  const f15 = await prisma.generation.findFirst({ where: { carModelId: x5.id, slug: "f15" } });
  const g05 = await prisma.generation.findFirst({ where: { carModelId: x5.id, slug: "g05" } });
  if (!f15 || !g05) throw new Error("F15/G05 generations not found — expected from the original seed-real-cars.ts run.");

  // --- F15: xDrive40e plug-in hybrid (2016-2018) ---
  const xdrive40e = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: f15.id, slug: "xdrive40e" } },
    update: {},
    create: { generationId: f15.id, slug: "xdrive40e", name: "xDrive40e (plug-in hybrid, 2016-2018)" },
  });
  if ((await prisma.engine.count({ where: { trimId: xdrive40e.id } })) === 0) {
    await prisma.engine.create({
      data: { trimId: xdrive40e.id, name: "2.0L Turbo I4 + electric motor, combined (N20)", powerHp: 308, fuel: "phev" },
    });
  }
  if (!(await prisma.battery.findFirst({ where: { trimId: xdrive40e.id } }))) {
    await prisma.battery.create({ data: { trimId: xdrive40e.id, capacityKwh: 9.0, rangeMiles: 14 } });
  }

  // --- G05: M Competition, M60i xDrive, xDrive50e ---
  type TrimSpec = { slug: string; name: string; engineName: string; powerHp: number; fuel: string };
  const g05Trims: TrimSpec[] = [
    { slug: "m-competition", name: "M Competition", engineName: "4.4L Twin-Turbo V8 (S68)", powerHp: 617, fuel: "petrol" },
    { slug: "m60i-xdrive", name: "M60i xDrive (2023-present, replaces M50i)", engineName: "4.4L Twin-Turbo V8, 48V mild hybrid (S68)", powerHp: 523, fuel: "petrol" },
  ];
  for (const t of g05Trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: g05.id, slug: t.slug } },
      update: {},
      create: { generationId: g05.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, fuel: t.fuel } });
    }
  }
  const xdrive50e = await prisma.trim.upsert({
    where: { generationId_slug: { generationId: g05.id, slug: "xdrive50e" } },
    update: {},
    create: { generationId: g05.id, slug: "xdrive50e", name: "xDrive50e (plug-in hybrid, 2023-present)" },
  });
  if ((await prisma.engine.count({ where: { trimId: xdrive50e.id } })) === 0) {
    await prisma.engine.create({
      data: { trimId: xdrive50e.id, name: "3.0L Turbo I6 + electric motor, combined (B58)", powerHp: 483, fuel: "phev" },
    });
  }
  if (!(await prisma.battery.findFirst({ where: { trimId: xdrive50e.id } }))) {
    await prisma.battery.create({ data: { trimId: xdrive50e.id, capacityKwh: 24, rangeMiles: 40 } });
  }

  console.log("Backfilled: F15 xDrive40e; G05 M Competition, M60i xDrive, xDrive50e.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
