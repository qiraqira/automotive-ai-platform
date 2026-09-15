import { prisma } from "@automotive/database";
import { fetchCarInfobox } from "./lib/wikipedia-car.js";
import { parseProductionYears } from "./lib/wikipedia-car.js";
import { seedEpaTrimsForNameplate } from "./lib/epa-trims.js";

// Complementary to backfill-all-generations.ts: that script only finds
// nameplates whose Wikipedia article has multiple "== Nth generation ==”
// sections to discover (a real, multi-generation history). Its own
// "[skip] ... only 0 generation section(s)" result is CORRECT, not a
// failure, for a genuinely new nameplate that has only ever had one
// real generation — Wikipedia's article never gains a second "==
// generation ==" header until a second one actually exists (Cadillac
// CT4, Genesis G70, Hyundai Ioniq 5, etc.), so 0 sections is the honest
// signal, not a gap. Those models are still stuck on auto-seed-
// catalog.ts's placeholder "Overview" generation name/dates, and never
// got real EPA trims (auto-seed-catalog.ts's own skeleton pass doesn't
// call the trim-seeding step at all). This promotes "Overview" to a
// real "First Generation" with real production dates (re-fetched from
// the same top-level infobox auto-seed-catalog.ts already used for
// facts/photo) and seeds real EPA trims for it — the single-generation
// equivalent of what backfill-all-generations.ts does per section.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CURRENT_YEAR = new Date().getFullYear();

async function main() {
  const candidates = await prisma.carModel.findMany({
    include: { brand: true, generations: true },
  });
  const targets = candidates.filter((c) => c.generations.length === 1 && c.generations[0]!.slug === "overview");
  console.log(`Found ${targets.length} single-"Overview"-generation models to promote.`);

  let promoted = 0;
  let skipped = 0;
  let errored = 0;
  for (const carModel of targets) {
    const overview = carModel.generations[0]!;
    const wikipediaTitle = `${carModel.brand.name} ${carModel.name}`;
    try {
      const infobox = await fetchCarInfobox(wikipediaTitle);
      const { startYear, endYear } = parseProductionYears(infobox.clean.production);
      if (!startYear) {
        console.log(`[skip] ${wikipediaTitle}: no real production year in its own infobox.`);
        skipped++;
        await sleep(300);
        continue;
      }
      // Real bug found live 2026-09-15: "0 generation sections found on
      // the combined page" does NOT mean single-generation — it can also
      // mean a real multi-generation nameplate documented via SEPARATE
      // per-generation Wikipedia articles (the BMW X5/F-150 pattern),
      // where the "{brand} {model}" page's own top-level infobox just
      // gives the nameplate's overall start year. Wrongly promoted Audi
      // A4/A6/A8 (each with 4-5 real, well-documented generations since
      // 1994) and BMW 2 Series (2 real generations since 2014) to a
      // single "First Generation 1994-present" before catching this live
      // — a large real span is the tell. Only promote when production
      // genuinely looks recent enough that a second generation plausibly
      // doesn't exist yet; older, long-lived nameplates need
      // research-nameplate.ts's real per-page discovery instead, same as
      // X5/F-150/Mustang/GLE got by hand.
      if (startYear < CURRENT_YEAR - 9) {
        console.log(`[skip] ${wikipediaTitle}: production since ${startYear} is too long a span to trust as one real generation — needs research-nameplate.ts's per-page discovery instead.`);
        skipped++;
        await sleep(300);
        continue;
      }
      await prisma.generation.update({ where: { id: overview.id }, data: { name: "First Generation", startYear, endYear } });

      const preferredYear = Math.min(endYear ?? CURRENT_YEAR - 1, CURRENT_YEAR - 1);
      let trims = 0;
      if (preferredYear >= startYear) {
        trims = await seedEpaTrimsForNameplate(overview.id, carModel.brand.name, carModel.name, preferredYear);
      }
      console.log(`[ok] ${wikipediaTitle}: First Generation ${startYear}-${endYear ?? "present"}, ${trims} trims.`);
      promoted++;
    } catch (err) {
      console.log(`[error] ${wikipediaTitle}: ${err instanceof Error ? err.message : String(err)}`);
      errored++;
    }
    await sleep(500);
  }
  console.log(`Done. ${promoted} promoted, ${skipped} skipped (no real date), ${errored} errored, out of ${targets.length}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
