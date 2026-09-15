import { prisma } from "@automotive/database";
import { seedEpaTrimsForNameplate } from "./lib/epa-trims.js";

// One-off: Ford Explorer's 41 trims were seeded before this session's
// own epa-trims.ts rewrite (redundant "modelName — opt.text" names that
// duplicated the Engine column, fixed the same day) — delete and reseed
// with the new, non-redundant drivetrain-based naming.

const CURRENT_YEAR = new Date().getFullYear();

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "ford" } });
  const explorer = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand!.id, slug: "explorer" } } });
  const gens = await prisma.generation.findMany({ where: { carModelId: explorer!.id }, orderBy: { startYear: "asc" } });

  for (const gen of gens) {
    const trims = await prisma.trim.findMany({ where: { generationId: gen.id } });
    const trimIds = trims.map((t) => t.id);
    await prisma.engine.deleteMany({ where: { trimId: { in: trimIds } } });
    await prisma.trim.deleteMany({ where: { id: { in: trimIds } } });
    const preferredYear = Math.min(gen.endYear ?? CURRENT_YEAR - 1, CURRENT_YEAR - 1);
    const created = await seedEpaTrimsForNameplate(gen.id, "Ford", "Explorer", preferredYear);
    console.log(`[ok] ${gen.name}: deleted ${trimIds.length}, reseeded ${created}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
