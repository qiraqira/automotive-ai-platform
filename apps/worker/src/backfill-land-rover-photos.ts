import { prisma } from "@automotive/database";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

// One-shot backfill, 2026-09-16 — user's own live site sweep found 3 of
// Land Rover's 5 catalog models with zero HERO photo at all (Range
// Rover, Range Rover Sport, Range Rover Evoque). Each source photo below
// was found via a real Wikimedia Commons search, downloaded, and looked
// at directly (see this session's own image review) before attaching —
// same "a person actually saw it" standard as backfill-bolt-ev-photo.ts,
// not a blind automated match (the failure mode that produced the
// WWII-poster/Xbox-logo mismatches found the same session).
async function attach(modelSlug: string, spec: Parameters<typeof attachCarModelPhoto>[1]) {
  const brand = await prisma.brand.findUnique({ where: { slug: "land-rover" } });
  if (!brand) throw new Error("land-rover brand not found");
  const model = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug } } });
  if (!model) throw new Error(`land-rover/${modelSlug} not found`);
  await attachCarModelPhoto(model.id, spec, "HERO", 0);
  console.log(`land-rover/${modelSlug}: done`);
}

async function main() {
  await attach("range-rover", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/2022%20Land%20Rover%20Range%20Rover%20SE%20P440e%20AWD%20Automatic%203.0%20Front.jpg",
    provider: "Wikimedia Commons",
    licenseSlug: "cc-by-sa-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true,
    artist: "Vauxford",
    altText: "Land Rover Range Rover (fifth generation, L460)",
  });

  await attach("range-rover-sport", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Land%20Rover%20Range%20Rover%20Sport%20L461%20Varesine%20Blue%20(8).jpg",
    provider: "Wikimedia Commons",
    licenseSlug: "cc-by-sa-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true,
    artist: "Damian B Oh",
    altText: "Land Rover Range Rover Sport (third generation, L461)",
  });

  await attach("range-rover-evoque", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Range%20Rover%20Evoque%20(L551)%20IMG%202660.jpg",
    provider: "Wikimedia Commons",
    licenseSlug: "cc-by-sa-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true,
    artist: "Alexander Migl",
    altText: "Land Rover Range Rover Evoque (second generation, L551)",
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
