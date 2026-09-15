import { prisma } from "@automotive/database";
import { fetchEpaVehicle } from "./lib/epa-fuel-economy.js";

// Follow-up to backfill-xc90-history.ts: seedEpaTrimsForNameplate's real
// EPA sweep for the Second Generation landed only 1 trim (T8 AWD
// Recharge) on both live runs — fetchNameplateHistory("Volvo","XC90",
// 2023,2023) intermittently came back empty against the real API from
// this container (network flakiness, not a real data gap: the same call
// succeeded and returned all three 2023 models — "XC90 B5 AWD", "XC90
// B6 AWD", "XC90 T8 AWD Recharge" — when run locally). Rather than keep
// retrying the full discovery sweep, this adds the two specific,
// already-confirmed-real EPA vehicle ids for the other two 2023 trims
// directly (same real fueleconomy.gov ids seedEpaTrimsForNameplate
// itself would have used: 45589 = XC90 B5 AWD, 45590 = XC90 B6 AWD).

async function main() {
  const gen = await prisma.generation.findUnique({ where: { id: "cmu2uenec0003k62sp32workd" } });
  if (!gen) throw new Error("Volvo XC90 Second Generation not found — expected id from backfill-xc90-history.ts's own run.");

  const entries: { modelName: string; epaId: string }[] = [
    { modelName: "XC90 B5 AWD", epaId: "45589" },
    { modelName: "XC90 B6 AWD", epaId: "45590" },
  ];

  let created = 0;
  for (const { modelName, epaId } of entries) {
    const slug = `epa-${epaId}`;
    const existing = await prisma.trim.findUnique({ where: { generationId_slug: { generationId: gen.id, slug } } });
    if (existing) continue;
    const vehicle = await fetchEpaVehicle(epaId);
    const trim = await prisma.trim.create({ data: { generationId: gen.id, slug, name: `${modelName} — Auto (${vehicle.trany}), ${vehicle.cylinders} cyl, ${vehicle.displ} L`.slice(0, 120) } });
    const mpgSuffix = vehicle.comb08 ? `, ${vehicle.comb08} MPG combined` : "";
    await prisma.engine.create({
      data: {
        trimId: trim.id,
        name: `${vehicle.cylinders ? `${vehicle.cylinders}-cyl, ` : ""}${vehicle.displ ? `${vehicle.displ}L, ` : ""}${vehicle.trany}${vehicle.tCharger === "T" ? " (turbo)" : ""}${vehicle.sCharger === "S" ? " (supercharged)" : ""}${mpgSuffix}`.trim(),
        fuel: vehicle.fuelType1 || null,
      },
    });
    created++;
  }
  console.log(`Added ${created} more Second Generation trim(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
