import { prisma } from "@automotive/database";
import { fetchEpaOptions, fetchEpaVehicle, fetchNameplateHistory, type EpaVehicleRecord } from "./epa-fuel-economy.js";

// Extracted 2026-09-15 from auto-seed-catalog.ts so backfill scripts for
// individual models (e.g. backfill-xc90-history.ts) can reuse the same
// real-EPA-data trim seeding instead of re-deriving engine/transmission
// text from scratch — auto-seed-catalog.ts itself now imports this same
// function rather than defining it inline.

// Real quality gap found live 2026-09-15, reviewing Ford Explorer:
// the old trim name (`opt.text`, e.g. "Auto 4-spd, 6 cyl, 4.0 L") is
// near-verbatim what the Engine column already shows on the same row —
// a reader sees the same cylinder/displacement/transmission text twice.
// EPA has no real marketing trim name (no "XLT"/"Limited") to offer
// instead, but it DOES carry a genuinely distinct, non-redundant fact
// per configuration: drivetrain.
function shortDrive(drive: string | undefined): string | null {
  if (!drive) return null;
  const d = drive.toLowerCase();
  if (d.includes("front")) return "FWD";
  if (d.includes("rear")) return "RWD";
  if (d.includes("all-wheel") && d.includes("4-wheel")) return "4WD/AWD";
  if (d.includes("all-wheel")) return "AWD";
  if (d.includes("4-wheel") || d.includes("four-wheel")) return "4WD";
  return null;
}

function shortTransmission(trany: string | undefined): string | null {
  if (!trany) return null;
  const t = trany.toLowerCase();
  if (t.startsWith("auto")) return t.includes("cvt") ? "CVT" : "Automatic";
  if (t.startsWith("man")) return "Manual";
  return null;
}

function engineName(vehicle: EpaVehicleRecord): string {
  const mpgSuffix = vehicle.comb08 ? `, ${vehicle.comb08} MPG combined` : "";
  return `${vehicle.cylinders ? `${vehicle.cylinders}-cyl, ` : ""}${vehicle.displ ? `${vehicle.displ}L, ` : ""}${vehicle.trany}${vehicle.tCharger === "T" ? " (turbo)" : ""}${vehicle.sCharger === "S" ? " (supercharged)" : ""}${mpgSuffix}`.trim();
}

/** Real bug found live 2026-09-15 reviewing Dodge Durango: a fixed
 * "{prefix} {drive} ({transmission})" label collides whenever two real
 * configs share the same drivetrain and transmission type but differ
 * only by engine (e.g. a 4.7L V8 and a 5.9L V8, both "Durango 2WD
 * (Automatic)") — three visually-identical Trim rows with different
 * Engine cells reads as a duplicated-row bug, not real data. Starting
 * from whatever base label the caller already built, progressively
 * appends displacement and transmission-speed-count ONLY to whichever
 * labels are still colliding after each step — most rows stay short,
 * only the genuinely ambiguous ones grow a disambiguator. */
function disambiguateLabels(base: string[], vehicles: EpaVehicleRecord[]): string[] {
  let labels = base;
  const hasDuplicates = (arr: string[]) => new Set(arr).size !== arr.length;

  if (hasDuplicates(labels)) {
    labels = vehicles.map((v, i) => {
      const current = labels[i]!;
      return labels.filter((l) => l === current).length > 1 && v.displ ? `${current} ${v.displ}L` : current;
    });
  }
  if (hasDuplicates(labels)) {
    labels = vehicles.map((v, i) => {
      const current = labels[i]!;
      const trans = shortTransmission(v.trany);
      return labels.filter((l) => l === current).length > 1 && trans ? `${current} (${trans})` : current;
    });
  }
  if (hasDuplicates(labels)) {
    // Last resort: a numbered suffix on whatever's still colliding —
    // rare (same drive, displacement AND transmission type on file
    // twice, e.g. two distinct tire-package EPA ids), but never leave
    // two trims on the same generation with byte-identical names.
    const seen = new Map<string, number>();
    labels = labels.map((l) => {
      const n = (seen.get(l) ?? 0) + 1;
      seen.set(l, n);
      return n > 1 ? `${l} #${n}` : l;
    });
  }
  return labels;
}

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

  // cap: some nameplates carry 15+ near-duplicate EPA configs (every
  // wheel-size/tire-package variant gets its own id) — 8 is enough to
  // show real spread (drivetrain/engine/fuel-type differences) without
  // flooding a model page with near-identical rows.
  const capped = options.slice(0, 8);
  const vehicles: (EpaVehicleRecord | null)[] = [];
  for (const opt of capped) {
    try {
      vehicles.push(await fetchEpaVehicle(opt.value));
    } catch {
      vehicles.push(null);
    }
  }
  const realVehicles = vehicles.filter((v): v is EpaVehicleRecord => v != null);
  const base = realVehicles.map((v) => [epaModel, shortDrive(v.drive)].filter(Boolean).join(" "));
  const labels = disambiguateLabels(base, realVehicles);

  let created = 0;
  let labelIdx = 0;
  for (let i = 0; i < capped.length; i++) {
    const vehicle = vehicles[i];
    if (!vehicle) continue;
    const label = labels[labelIdx++]!;
    const slug = `epa-${capped[i]!.value}`;
    const existing = await prisma.trim.findUnique({ where: { generationId_slug: { generationId, slug } } });
    if (existing) continue;
    const trim = await prisma.trim.create({ data: { generationId, slug, name: label.slice(0, 120) } });
    // Combined MPG/range isn't stored as a separate Fact/Battery row here — EPA's
    // XML doesn't carry EV battery kWh at all, and folding gas/hybrid combined MPG
    // into the Engine's own name string (below) avoids forcing a schema mismatch
    // (Battery is EV-only per its capacityKwh/rangeKm fields) for a single number.
    await prisma.engine.create({ data: { trimId: trim.id, name: engineName(vehicle), fuel: vehicle.fuelType1 || null } });
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
  // Real bug found live 2026-09-15 (BMW 7 Series E38): a `for (...; year--)`
  // loop decrements `year` in its increment clause even on the iteration
  // that successfully finds modelNames, so `year` no longer matches the
  // year those modelNames actually came from once the loop exits. EPA's
  // model-name strings aren't stable year to year (2000 filed "740i/740i
  // Sport", 1999 filed the same trim as bare "740i") — every fetchEpaOptions
  // call below silently used the wrong year's naming and returned nothing.
  // Track the year that matched separately instead of reusing the loop
  // variable after it's kept moving.
  let modelNames: string[] = [];
  let matchedYear = preferredYear;
  for (let tries = 0, year = preferredYear; tries < 4 && modelNames.length === 0; tries++, year--) {
    const history = await fetchNameplateHistory(epaMake, nameplateSubstring, year, year);
    modelNames = history[year] ?? [];
    matchedYear = year;
  }
  if (modelNames.length === 0) return 0;
  const year = matchedYear;

  // Real bug found live 2026-09-15 (Audi A7): two real EPA option ids
  // both listed under the exact same modelName string ("A7 quattro"),
  // differing only in some dimension disambiguateLabels() doesn't track
  // (e.g. trim package) — since it used to run separately PER modelName
  // loop iteration, it never saw the other iteration's identical label
  // and both trims landed on the live page reading "A7 quattro" twice
  // with no distinguishing suffix at all. Every modelName's options are
  // now gathered first, and disambiguation runs ONCE across the whole
  // generation, so a collision between two different modelName groups
  // (or within one) is always caught.
  const entries: { optValue: string; baseLabel: string; vehicle: EpaVehicleRecord }[] = [];
  for (const modelName of modelNames) {
    if (entries.length >= 8) break;
    const options = (await fetchEpaOptions(year, epaMake, modelName)).slice(0, 8 - entries.length);
    for (const opt of options) {
      let vehicle: EpaVehicleRecord;
      try {
        vehicle = await fetchEpaVehicle(opt.value);
      } catch {
        continue;
      }
      // modelName here is already EPA's own drivetrain/powertrain-
      // specific model string (e.g. "XC90 B5 AWD") — real, distinct
      // trim identity on its own, so it's the base label directly (no
      // drivetrain suffix — shortDrive() would just repeat what
      // modelName already encodes, e.g. "XC90 B5 AWD AWD").
      entries.push({ optValue: opt.value, baseLabel: modelName, vehicle });
    }
  }
  const labels = disambiguateLabels(
    entries.map((e) => e.baseLabel),
    entries.map((e) => e.vehicle),
  );

  let created = 0;
  for (let i = 0; i < entries.length; i++) {
    const { optValue, vehicle } = entries[i]!;
    const label = labels[i]!;
    const slug = `epa-${optValue}`;
    const existing = await prisma.trim.findUnique({ where: { generationId_slug: { generationId, slug } } });
    if (existing) continue;
    const trim = await prisma.trim.create({ data: { generationId, slug, name: label.slice(0, 120) } });
    await prisma.engine.create({ data: { trimId: trim.id, name: engineName(vehicle), fuel: vehicle.fuelType1 || null } });
    created++;
  }
  return created;
}
