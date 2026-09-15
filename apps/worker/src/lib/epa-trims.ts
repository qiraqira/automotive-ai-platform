import { prisma } from "@automotive/database";
import { fetchEpaOptions, fetchEpaVehicle, fetchNameplateHistory, type EpaVehicleRecord } from "./epa-fuel-economy.js";

// Extracted 2026-09-15 from auto-seed-catalog.ts so backfill scripts for
// individual models (e.g. backfill-xc90-history.ts) can reuse the same
// real-EPA-data trim seeding instead of re-deriving engine/transmission
// text from scratch — auto-seed-catalog.ts itself now imports this same
// function rather than defining it inline.

export async function seedEpaTrims(generationId: string, epaMake: string, epaModel: string, preferredYear: number): Promise<number> {
  // EPA's fueleconomy.gov reliably lags the actual calendar year by more than
  // one model year in practice (found live 2026-09-14: neither 2025 nor 2026
  // Toyota Camry returned anything, 2024 did) — walk backward from the
  // preferred year rather than trusting a single hardcoded offset.
  let options: Awaited<ReturnType<typeof fetchEpaOptions>> = [];
  let year = preferredYear;
  for (let tries = 0; tries < 4 && options.length === 0; tries++, year--) {
    options = await fetchEpaOptions(year, epaMake, epaModel);
  }
  if (options.length === 0) return 0;
  let created = 0;
  for (const opt of options.slice(0, 8)) {
    // cap: some nameplates carry 15+ near-duplicate EPA configs (every
    // wheel-size/tire-package variant gets its own id) — 8 is enough to
    // show real spread (drivetrain/engine/fuel-type differences) without
    // flooding a model page with near-identical rows.
    let vehicle: EpaVehicleRecord;
    try {
      vehicle = await fetchEpaVehicle(opt.value);
    } catch {
      continue;
    }
    const slug = `epa-${opt.value}`;
    const existing = await prisma.trim.findUnique({ where: { generationId_slug: { generationId, slug } } });
    if (existing) continue;
    const trim = await prisma.trim.create({ data: { generationId, slug, name: opt.text.slice(0, 120) } });
    // Combined MPG/range isn't stored as a separate Fact/Battery row here — EPA's
    // XML doesn't carry EV battery kWh at all, and folding gas/hybrid combined MPG
    // into the Engine's own name string (below) avoids forcing a schema mismatch
    // (Battery is EV-only per its capacityKwh/rangeKm fields) for a single number.
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
  return created;
}

/** Same as seedEpaTrims, but for a nameplate where EPA doesn't file every
 * trim under one fixed model string — e.g. "Volvo XC90" is filed as
 * separate EPA models per drivetrain/powertrain ("XC90 AWD", "XC90 B5
 * AWD", "XC90 T8 AWD Recharge", ...), the same real quirk this file's
 * own epa-fuel-economy.ts already documents for the BMW X5 ("X5
 * 3.0si"/"X5 4.8i" as of 2007). Discovers the real per-year model
 * strings itself via fetchNameplateHistory rather than requiring them
 * to be hand-listed, then fetches options for each. */
export async function seedEpaTrimsForNameplate(
  generationId: string,
  epaMake: string,
  nameplateSubstring: string,
  preferredYear: number,
): Promise<number> {
  let modelNames: string[] = [];
  let year = preferredYear;
  for (let tries = 0; tries < 4 && modelNames.length === 0; tries++, year--) {
    const history = await fetchNameplateHistory(epaMake, nameplateSubstring, year, year);
    modelNames = history[year] ?? [];
  }
  if (modelNames.length === 0) return 0;

  let created = 0;
  for (const modelName of modelNames) {
    if (created >= 8) break;
    const options = await fetchEpaOptions(year, epaMake, modelName);
    for (const opt of options) {
      if (created >= 8) break;
      let vehicle: EpaVehicleRecord;
      try {
        vehicle = await fetchEpaVehicle(opt.value);
      } catch {
        continue;
      }
      const slug = `epa-${opt.value}`;
      const existing = await prisma.trim.findUnique({ where: { generationId_slug: { generationId, slug } } });
      if (existing) continue;
      const trim = await prisma.trim.create({ data: { generationId, slug, name: `${modelName} — ${opt.text}`.slice(0, 120) } });
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
  }
  return created;
}
