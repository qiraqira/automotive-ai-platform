import { prisma } from "@automotive/database";

// Whole-catalog follow-up to fix-explorer-alt-text.ts: lib/apply-
// generations.ts's hero-relink step only started updating a relinked
// photo's altText partway through this session (the fix that landed
// alongside the Ford Explorer review) — every model whose HERO photo
// was relinked from the "Overview" placeholder generation BEFORE that
// fix shipped (found live: Chevrolet Equinox) still has a stale
// "... (Overview)" altText, even though "Overview" no longer exists as
// a generation on that model at all. Matches any CarModelImage whose
// altText contains "(Overview)" and rewrites it from its own current,
// real generation.

async function main() {
  const stale = await prisma.carModelImage.findMany({
    where: { altText: { contains: "(Overview)" } },
    include: { generation: true, carModel: { include: { brand: true } } },
  });
  console.log(`Found ${stale.length} image(s) with stale "(Overview)" alt text.`);

  let fixed = 0;
  for (const img of stale) {
    if (!img.generation) {
      console.log(`[skip] ${img.carModel.brand.name} ${img.carModel.name}: no generation linked, can't rebuild alt text.`);
      continue;
    }
    const cleanAlt = `${img.carModel.brand.name} ${img.carModel.name} (${img.generation.name})`;
    await prisma.carModelImage.update({ where: { id: img.id }, data: { altText: cleanAlt } });
    console.log(`[ok] "${img.altText}" -> "${cleanAlt}"`);
    fixed++;
  }
  console.log(`Fixed ${fixed} of ${stale.length}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
