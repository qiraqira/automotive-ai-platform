import { prisma } from "@automotive/database";
import { seedEpaTrimsForNameplate } from "./lib/epa-trims.js";

// One-off, same pattern as reseed-explorer-trims.ts: Jeep Cherokee's real
// EPA trims (deleted directly in the database — see this session's own
// fix to lib/epa-fuel-economy.ts's fetchNameplateHistory, "Cherokee"
// used to substring-match "Grand Cherokee L" too) get reseeded here
// using the now-fixed startsWith-based matching.

const CURRENT_YEAR = new Date().getFullYear();

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "jeep" } });
  const cherokee = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand!.id, slug: "cherokee" } } });
  const gens = await prisma.generation.findMany({ where: { carModelId: cherokee!.id }, orderBy: { startYear: "asc" } });

  for (const gen of gens) {
    const preferredYear = Math.min(gen.endYear ?? CURRENT_YEAR - 1, CURRENT_YEAR - 1);
    if (preferredYear < (gen.startYear ?? 1980)) continue;
    const created = await seedEpaTrimsForNameplate(gen.id, "Jeep", "Cherokee", preferredYear);
    console.log(`[ok] ${gen.name}: reseeded ${created}`);
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
