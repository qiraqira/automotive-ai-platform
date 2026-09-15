import { prisma } from "@automotive/database";
import { applyGenerationSectionsForModel } from "./lib/apply-generations.js";

// CLI wrapper around lib/apply-generations.ts's shared core (see that
// file's own header) for running one model by hand and reading its
// output directly, e.g. to sanity-check a model before trusting
// backfill-all-generations.ts's unattended whole-catalog sweep on it.
//
// `npm run backfill:generations --workspace @automotive/worker --
//   <brandSlug> <modelSlug> [wikipediaTitle]`

async function main() {
  const [brandSlug, modelSlug, wikipediaTitleArg] = process.argv.slice(2);
  if (!brandSlug || !modelSlug) {
    console.error("Usage: npm run backfill:generations --workspace @automotive/worker -- <brandSlug> <modelSlug> [wikipediaTitle]");
    process.exitCode = 1;
    return;
  }

  const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
  if (!brand) throw new Error(`Brand "${brandSlug}" not found.`);
  const carModel = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug } } });
  if (!carModel) throw new Error(`CarModel "${brandSlug}/${modelSlug}" not found.`);

  const result = await applyGenerationSectionsForModel(brandSlug, brand.name, modelSlug, carModel.name, carModel.id, wikipediaTitleArg);
  console.log(`${brand.name} ${carModel.name}:`, result);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
