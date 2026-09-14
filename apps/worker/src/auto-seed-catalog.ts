import { prisma } from "@automotive/database";
import { readFile } from "node:fs/promises";
import { fetchCarInfobox } from "./lib/wikipedia-car.js";
import { fetchCommonsFileInfo } from "./lib/commons-search.js";
import { fetchEpaOptions, fetchEpaVehicle, type EpaVehicleRecord } from "./lib/epa-fuel-economy.js";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

// User's explicit ask (2026-09-14): "запусти парсер каталога на серваке,
// пусть создает каталог сам, не трать токены" — a fully unattended
// catalog builder that runs server-side against a curated model list,
// using only the deterministic sources this project already built
// (lib/wikipedia-car.ts, lib/epa-fuel-economy.ts, lib/commons-search.ts)
// rather than the session doing per-model WebSearch/WebFetch research
// the way every seed-<model>.ts file up to now was hand-written.
//
// One deliberate departure from this project's established "a person
// actually looked at it" photo rule (seed-model3.ts and
// lib/attach-car-photo.ts's own header): there is no human review step
// here. The substitute safeguard is using ONLY the Wikipedia infobox's
// own `image` field — the exact lead photo Wikipedia's own editors
// already curated for that specific model/generation article, fetched
// by exact filename (fetchCommonsFileInfo), never a fuzzy keyword search
// that could return a different generation or the wrong nameplate
// entirely. If a page has no infobox image, or the image fails Commons'
// license/type filter, the entry is created with no hero photo rather
// than guessing — same "skip rather than force a wrong photo" policy
// this session already applies to news articles.
//
// EPA trim data: only the most recent full model year is fetched (kept
// deliberately light — one make/model/year is already several HTTP
// calls, one per distinct engine/transmission option) and each distinct
// EPA configuration becomes its own Trim, named from EPA's own option
// text (never an invented marketing trim name like "LE"/"Sport").

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface CatalogSeedEntry {
  brandSlug: string;
  brandName: string;
  brandCountry?: string;
  modelSlug: string;
  modelName: string;
  wikipediaTitle: string;
  generationSlug: string;
  generationName: string;
  epaMake?: string;
  epaModel?: string;
  epaYear?: number; // defaults to CURRENT_YEAR - 1 if epaMake/epaModel given
}

const CURRENT_YEAR = new Date().getFullYear();

function parseProductionYears(raw: string | undefined): { startYear: number | null; endYear: number | null } {
  if (!raw) return { startYear: null, endYear: null };
  const years = Array.from(raw.matchAll(/\b(19|20)\d{2}\b/g), (m) => Number(m[0]));
  if (years.length === 0) return { startYear: null, endYear: null };
  const startYear = Math.min(...years);
  const isOngoing = /present/i.test(raw);
  const endYear = isOngoing ? null : years.length > 1 ? Math.max(...years) : null;
  return { startYear, endYear };
}

async function upsertFactsFromInfobox(carModelId: string, infobox: Record<string, string>): Promise<number> {
  const attributeMap: Record<string, string> = {
    platform: "platform",
    assembly: "assembly_location",
    class: "vehicle_class",
    layout: "drivetrain_layout",
    predecessor: "predecessor",
    successor: "successor",
  };
  let created = 0;
  for (const [field, attribute] of Object.entries(attributeMap)) {
    const value = infobox[field];
    if (!value) continue;
    const existing = await prisma.fact.findFirst({ where: { carModelId, attribute } });
    if (existing) continue;
    await prisma.fact.create({
      data: {
        carModelId,
        attribute,
        value: value.slice(0, 500),
        status: "REPORTED", // auto-parsed from Wikipedia's infobox, not independently confirmed
        confidence: 0.6,
      },
    });
    created++;
  }
  return created;
}

async function attachInfoboxPhoto(carModelId: string, generationId: string, infobox: Record<string, string>, altText: string): Promise<boolean> {
  const rawImage = infobox.image;
  if (!rawImage) return false;
  // Infobox `image` fields are sometimes a plain filename, sometimes
  // "[[File:X.jpg]]"-wrapped, sometimes carry a trailing "|thumb|..." —
  // cleanWikitext() already ran on this string, so what remains here is
  // typically just the bare filename with no brackets.
  const filename = rawImage.split("|")[0]?.trim();
  if (!filename) return false;
  const file = await fetchCommonsFileInfo(filename);
  if (!file) return false;
  await attachCarModelPhoto(
    carModelId,
    {
      sourceUrl: file.fullUrl,
      provider: "Wikimedia Commons",
      licenseSlug: file.licenseSlug,
      licenseUrl: file.licenseUrl,
      attributionRequired: file.attributionRequired,
      artist: file.artist,
      altText,
    },
    "HERO",
    0,
    generationId,
  );
  return true;
}

async function seedEpaTrims(generationId: string, epaMake: string, epaModel: string, year: number): Promise<number> {
  const options = await fetchEpaOptions(year, epaMake, epaModel);
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

async function seedOne(entry: CatalogSeedEntry): Promise<{ ok: boolean; note: string }> {
  const brand = await prisma.brand.upsert({
    where: { slug: entry.brandSlug },
    update: {},
    create: { slug: entry.brandSlug, name: entry.brandName, country: entry.brandCountry },
  });
  const carModel = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: brand.id, slug: entry.modelSlug } },
    update: {},
    create: { brandId: brand.id, slug: entry.modelSlug, name: entry.modelName },
  });

  let infobox: Record<string, string> | null = null;
  try {
    infobox = (await fetchCarInfobox(entry.wikipediaTitle)).clean;
  } catch (err) {
    return { ok: false, note: `infobox fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const { startYear, endYear } = parseProductionYears(infobox.production);
  const generation = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: carModel.id, slug: entry.generationSlug } },
    update: {},
    create: {
      carModelId: carModel.id,
      slug: entry.generationSlug,
      name: entry.generationName,
      startYear,
      endYear,
    },
  });

  const factsCreated = await upsertFactsFromInfobox(carModel.id, infobox);
  const photoAttached = await attachInfoboxPhoto(carModel.id, generation.id, infobox, `${entry.brandName} ${entry.modelName} (${entry.generationName})`);

  let trimsCreated = 0;
  if (entry.epaMake && entry.epaModel) {
    const year = entry.epaYear ?? CURRENT_YEAR - 1;
    try {
      trimsCreated = await seedEpaTrims(generation.id, entry.epaMake, entry.epaModel, year);
    } catch (err) {
      // EPA has nothing for this make/model/year combination often enough
      // (new nameplates, non-US markets) that this is expected, not fatal.
      console.log(`  [${entry.modelSlug}] EPA fetch skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    ok: true,
    note: `facts=${factsCreated} photo=${photoAttached ? "yes" : "no"} trims=${trimsCreated}`,
  };
}

async function main() {
  const listPath = process.argv[2];
  if (!listPath) {
    console.error("Usage: npm run seed:catalog-auto --workspace @automotive/worker -- <path-to-model-list.json>");
    process.exitCode = 1;
    return;
  }
  const entries = JSON.parse(await readFile(listPath, "utf-8")) as CatalogSeedEntry[];
  console.log(`Auto-seeding ${entries.length} catalog entries from ${listPath}...`);

  let succeeded = 0;
  let failed = 0;
  for (const entry of entries) {
    try {
      const result = await seedOne(entry);
      if (result.ok) {
        succeeded++;
        console.log(`[ok] ${entry.brandName} ${entry.modelName} (${entry.generationName}) — ${result.note}`);
      } else {
        failed++;
        console.log(`[skip] ${entry.brandName} ${entry.modelName} — ${result.note}`);
      }
    } catch (err) {
      failed++;
      console.log(`[error] ${entry.brandName} ${entry.modelName} — ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(500); // stay polite to Wikipedia/EPA/Commons across a long run
  }
  console.log(`Done. ${succeeded} succeeded, ${failed} failed/skipped out of ${entries.length}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
