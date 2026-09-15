import { prisma } from "@automotive/database";
import { readFile } from "node:fs/promises";
import { fetchCarInfobox, searchWikipediaTitles, parseProductionYears, type CarInfobox } from "./lib/wikipedia-car.js";
import { fetchCommonsFileInfo } from "./lib/commons-search.js";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";
import { seedEpaTrims } from "./lib/epa-trims.js";

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

// A hardcoded chassis-code/generation title guess (e.g. "Toyota Highlander
// (XU70)") is often wrong — this session's own curated model list got only
// 13/32 right on the first pass. Rather than requiring every entry's title
// to be hand-verified (exactly the per-model token cost this pipeline
// exists to avoid), fall back to Wikipedia's own search index — the same
// discovery approach research-nameplate.ts already uses.
//
// Real bug found live 2026-09-14, first fallback-enabled run: a
// brand-only relevance check (matching research-nameplate.ts's own
// `looksRelevant`, which is only ever a sort hint there for a
// human-reviewed report, never an auto-accept gate) let "Tesla
// Model S" silently resolve to "Tesla Cybercab" — a real, different
// Tesla model — because both mention "Tesla". The same run also
// resolved "Chevrolet Silverado" (intended: fourth generation, current)
// to "Chevrolet Silverado (second generation)" (2007-2013) — correct
// model, wrong era. Fixed two ways: (1) the model name itself, not just
// the brand, must appear in the *candidate title* (not just infobox
// prose, which can mention a related-but-wrong model in passing); (2)
// the generation slug/name attached to the database is now always
// derived from what was ACTUALLY fetched (the resolved title's own
// parenthetical qualifier, if any) rather than trusting this entry's
// pre-set generationSlug/generationName, which described the title this
// session originally guessed — possibly not the one actually resolved.
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s-]/g, "");
}

function deriveGenerationLabel(resolvedTitle: string): { slug: string; name: string } {
  const qualifierMatch = /\(([^)]+)\)\s*$/.exec(resolvedTitle);
  const qualifier = qualifierMatch?.[1]?.trim();
  if (!qualifier) return { slug: "overview", name: "Overview" };
  const slug = qualifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = qualifier.replace(/\b\w/g, (c) => c.toUpperCase());
  return { slug: slug || "overview", name };
}

async function resolveInfobox(
  entry: CatalogSeedEntry,
): Promise<{ infobox: CarInfobox; resolvedTitle: string; usedFallback: boolean } | { error: string }> {
  try {
    const infobox = await fetchCarInfobox(entry.wikipediaTitle);
    return { infobox, resolvedTitle: entry.wikipediaTitle, usedFallback: false };
  } catch {
    // fall through to search-based discovery below
  }

  const candidates = Array.from(
    new Set([
      ...(await searchWikipediaTitles(`${entry.brandName} ${entry.modelName} generation`, 6)),
      ...(await searchWikipediaTitles(`${entry.brandName} ${entry.modelName}`, 4)),
    ]),
  );
  const brandNeedle = normalizeForMatch(entry.brandName);
  const modelNeedle = normalizeForMatch(entry.modelName);
  for (const title of candidates) {
    await sleep(250); // proactive spacing across candidate fetches, same rationale as research-nameplate.ts
    const titleNorm = normalizeForMatch(title);
    // Both the brand AND the model name must appear in the candidate's own
    // title — not just somewhere in its infobox prose, which routinely
    // mentions sibling/related models (an unrelated Tesla product's page
    // still says "Tesla" as manufacturer).
    if (!titleNorm.includes(brandNeedle) || !titleNorm.includes(modelNeedle)) continue;
    let infobox: CarInfobox;
    try {
      infobox = await fetchCarInfobox(title);
    } catch {
      continue;
    }
    return { infobox, resolvedTitle: title, usedFallback: true };
  }
  return { error: `no Wikipedia infobox found for "${entry.wikipediaTitle}" or any search fallback matching both brand and model in the title` };
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

  const resolved = await resolveInfobox(entry);
  if ("error" in resolved) {
    return { ok: false, note: resolved.error };
  }
  const infobox = resolved.infobox.clean;
  const fallbackNote = resolved.usedFallback ? ` (via search: "${resolved.resolvedTitle}")` : "";

  // When the fallback resolved a DIFFERENT page than this entry's own guess,
  // the pre-set generationSlug/generationName described the guess, not what
  // was actually fetched — using it here would repeat this file's own
  // Silverado bug (real second-generation data mislabeled "Fourth
  // Generation"). Only trust the pre-set label on a direct hit; derive an
  // honest one from the resolved title itself otherwise.
  const { slug: generationSlug, name: generationName } = resolved.usedFallback
    ? deriveGenerationLabel(resolved.resolvedTitle)
    : { slug: entry.generationSlug, name: entry.generationName };

  const { startYear, endYear } = parseProductionYears(infobox.production);
  const generation = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: carModel.id, slug: generationSlug } },
    update: {},
    create: {
      carModelId: carModel.id,
      slug: generationSlug,
      name: generationName,
      startYear,
      endYear,
    },
  });

  const factsCreated = await upsertFactsFromInfobox(carModel.id, infobox);
  const photoAttached = await attachInfoboxPhoto(carModel.id, generation.id, infobox, `${entry.brandName} ${entry.modelName} (${generationName})`);

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
    note: `facts=${factsCreated} photo=${photoAttached ? "yes" : "no"} trims=${trimsCreated}${fallbackNote}`,
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
