import { prisma } from "@automotive/database";
import { applyGenerationSectionsForModel } from "./lib/apply-generations.js";

// Unattended whole-catalog sweep, per the user's own repeated 2026-09-15
// instruction to keep writing parsers/mechanisms rather than doing this
// model-by-model by hand ("постарайся парсеры писать, не тратить
// токены"). Runs lib/apply-generations.ts's shared core (see its own
// header, and apply-generation-sections.ts's single-model CLI) against
// every CarModel currently in the DB with fewer than 2 real generations
// — whatever auto-seed-catalog.ts's own broad skeleton pass produced,
// plus any of the original hand-seeded models never taken further.
// Purely additive/safe to re-run: every write underneath (Generation/
// CarModelImage/Trim upserts, the placeholder-"overview"-delete) is
// already idempotent in lib/apply-generations.ts and
// lib/attach-car-photo.ts.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const carModels = await prisma.carModel.findMany({
    include: { brand: true, generations: { select: { id: true } } },
    orderBy: [{ brand: { name: "asc" } }, { name: "asc" }],
  });
  const targets = carModels.filter((c) => c.generations.length < 2);
  console.log(`Sweeping ${targets.length} of ${carModels.length} CarModels with <2 generations...`);

  let applied = 0;
  let tooFew = 0;
  let errored = 0;
  for (const c of targets) {
    try {
      const result = await applyGenerationSectionsForModel(c.brand.slug, c.brand.name, c.slug, c.name, c.id);
      if (result.status === "applied") {
        applied++;
        console.log(`[ok] ${c.brand.name} ${c.name}: ${result.generations} generations, ${result.trims} trims`);
      } else if (result.status === "too_few_sections") {
        tooFew++;
        console.log(`[skip] ${c.brand.name} ${c.name}: only ${result.sectionsFound} generation section(s) on its own Wikipedia page — needs research-nameplate.ts's per-page discovery instead`);
      } else {
        errored++;
        console.log(`[error] ${c.brand.name} ${c.name}: ${result.message}`);
      }
    } catch (err) {
      errored++;
      console.log(`[error] ${c.brand.name} ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(500); // stay polite to Wikipedia/EPA/Commons across a long run
  }
  console.log(`Done. ${applied} applied, ${tooFew} need per-page discovery, ${errored} errored, out of ${targets.length} swept.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
