import { prisma } from "@automotive/database";
import { seedEpaTrimsForNameplate } from "./lib/epa-trims.js";

// Whole-catalog follow-up to reseed-explorer-trims.ts: the redundant
// "modelName — opt.text" / bare-opt.text trim naming this session fixed
// in lib/epa-trims.ts wasn't unique to Ford Explorer — every generation
// ever seeded by seedEpaTrims/seedEpaTrimsForNameplate (auto-seed-
// catalog.ts's initial pass and backfill-all-generations.ts's sweep)
// has the same old names, including Volvo XC90 — already
// catalogReviewedAt and LIVE on the site with this exact quality
// problem. Every auto-generated trim carries an "epa-<id>" slug (see
// both seed functions' own `slug` field) — real, hand-picked trims
// (BMW X5, GLE, F-150, Mustang; Chevrolet Camaro's "ss"/"zl1" etc.)
// never use that prefix, so this only ever touches EPA-derived rows.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CURRENT_YEAR = new Date().getFullYear();

async function main() {
  const epaTrims = await prisma.trim.findMany({
    where: { slug: { startsWith: "epa-" } },
    select: { id: true, generationId: true },
  });
  const generationIds = Array.from(new Set(epaTrims.map((t) => t.generationId)));
  console.log(`Found ${epaTrims.length} EPA-derived trims across ${generationIds.length} generations. Reseeding...`);

  let totalDeleted = 0;
  let totalCreated = 0;
  let gensDone = 0;
  for (const generationId of generationIds) {
    const gen = await prisma.generation.findUnique({
      where: { id: generationId },
      include: { carModel: { include: { brand: true } } },
    });
    if (!gen) continue;
    const trims = await prisma.trim.findMany({ where: { generationId, slug: { startsWith: "epa-" } } });
    const trimIds = trims.map((t) => t.id);
    await prisma.engine.deleteMany({ where: { trimId: { in: trimIds } } });
    await prisma.trim.deleteMany({ where: { id: { in: trimIds } } });
    totalDeleted += trimIds.length;

    const preferredYear = Math.min(gen.endYear ?? CURRENT_YEAR - 1, CURRENT_YEAR - 1);
    let created = 0;
    try {
      created = await seedEpaTrimsForNameplate(gen.id, gen.carModel.brand.name, gen.carModel.name, preferredYear);
    } catch (err) {
      console.log(`[error] ${gen.carModel.brand.name} ${gen.carModel.name} — ${gen.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    totalCreated += created;
    gensDone++;
    console.log(`[${gensDone}/${generationIds.length}] ${gen.carModel.brand.name} ${gen.carModel.name} — ${gen.name}: deleted ${trimIds.length}, reseeded ${created}`);
    await sleep(500);
  }
  console.log(`Done. Deleted ${totalDeleted}, reseeded ${totalCreated}, across ${gensDone} generations.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
