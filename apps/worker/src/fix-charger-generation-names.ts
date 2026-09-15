import { prisma } from "@automotive/database";
import { discoverGenerationSections } from "./lib/generation-sections.js";

// One-shot fix for Dodge Charger specifically: its 8 Generation rows
// were written by backfill-all-generations.ts's original run, BEFORE
// lib/generation-sections.ts's name-cleaning bug was fixed the same day
// (colon-style headers like "First generation: 1966-1967" weren't
// stripped of their year range, so the car page's own "(startYear-
// endYear)" suffix doubled up into "First generation: 1966-1967
// (1966-1967)"). The bug fix only changes future discovery runs, not
// rows already in the database — this re-derives each existing
// Charger generation's `name` from the now-fixed cleaner and updates it
// in place (matched by startYear, not slug, since re-deriving the slug
// too would risk breaking Trim/CarModelImage rows that already point at
// the current generationId — nothing about the underlying id changes).

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "dodge" } });
  if (!brand) throw new Error("Dodge brand not found.");
  const charger = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: "charger" } } });
  if (!charger) throw new Error("Dodge Charger CarModel not found.");

  const sections = await discoverGenerationSections("Dodge Charger");
  const existing = await prisma.generation.findMany({ where: { carModelId: charger.id } });

  let updated = 0;
  for (const gen of existing) {
    const match = sections.find((s) => s.startYear === gen.startYear);
    if (match && match.name !== gen.name) {
      await prisma.generation.update({ where: { id: gen.id }, data: { name: match.name } });
      console.log(`[ok] "${gen.name}" -> "${match.name}"`);
      updated++;
    }
  }
  console.log(`Updated ${updated} of ${existing.length} generation name(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
