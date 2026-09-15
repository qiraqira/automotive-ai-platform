import { prisma } from "@automotive/database";
import { fetchCommonsFileInfo } from "./lib/commons-search.js";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";
import { seedEpaTrimsForNameplate } from "./lib/epa-trims.js";

// One-shot CLI (`npm run backfill:nissan-z-history --workspace
// @automotive/worker`). Nissan Z needed the X5/F-150/GLE pattern (real,
// separate per-era Wikipedia articles — research-nameplate.ts's own
// search-based discovery, not the single-page section-header scan
// backfill-all-generations.ts uses) rather than the mechanical sweep:
// its "Nissan Z" page is a short overview/current-model article, with
// the real generation-by-generation history spread across "Nissan
// Fairlady Z (S30)", "(S130)", "Nissan 300ZX", "Nissan 350Z", "Nissan
// 370Z" and "Nissan Z (RZ34)" — confirmed live via research-
// nameplate.ts 2026-09-15. "Nissan 300ZX" covers both the Z31 (1984)
// and Z32 (1989) as one combined article (real, not a parsing gap —
// its own infobox gives a single continuous "1983–2000" production
// span and only ONE real Wikipedia article exists for it, unlike XC90's
// two-articles-for-two-generations case).

const CURRENT_YEAR = new Date().getFullYear();

interface GenSpec {
  slug: string;
  name: string;
  startYear: number;
  endYear: number | null;
  wikipediaTitle: string;
  image: string;
}

const GENERATIONS: GenSpec[] = [
  { slug: "s30", name: "S30 (Fairlady Z / 240Z-260Z-280Z)", startYear: 1969, endYear: 1978, wikipediaTitle: "Nissan Fairlady Z (S30)", image: "1970-1973 Nissan Fairlady Z.jpg" },
  { slug: "s130", name: "S130 (280ZX)", startYear: 1978, endYear: 1983, wikipediaTitle: "Nissan Fairlady Z (S130)", image: "Mondial de l'Automobile 2010, Paris - France (5058943600).jpg" },
  { slug: "z31-z32-300zx", name: "300ZX (Z31/Z32)", startYear: 1983, endYear: 2000, wikipediaTitle: "Nissan 300ZX", image: "1996 Nissan 300ZX 2-seater t-top, front left, 06-15-2025.jpg" },
  { slug: "z33-350z", name: "350Z (Z33)", startYear: 2003, endYear: 2009, wikipediaTitle: "Nissan 350Z", image: "Nissan 350z czarny.JPG" },
  { slug: "z34-370z", name: "370Z (Z34)", startYear: 2008, endYear: 2020, wikipediaTitle: "Nissan 370Z", image: "NISSAN 370Z (3106421295).jpg" },
  { slug: "rz34-z", name: "Z (RZ34)", startYear: 2022, endYear: null, wikipediaTitle: "Nissan Z (RZ34)", image: "Nissan FAIRLADY Z (Z34) Version ST, 2022, left-front.jpg" },
];

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "nissan" } });
  if (!brand) throw new Error("Nissan brand not found.");
  const z = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: "z" } } });
  if (!z) throw new Error("Nissan Z CarModel not found.");

  let totalTrims = 0;
  for (const spec of GENERATIONS) {
    const gen = await prisma.generation.upsert({
      where: { carModelId_slug: { carModelId: z.id, slug: spec.slug } },
      update: {},
      create: { carModelId: z.id, slug: spec.slug, name: spec.name, startYear: spec.startYear, endYear: spec.endYear },
    });

    const file = await fetchCommonsFileInfo(spec.image);
    if (file) {
      await attachCarModelPhoto(
        z.id,
        {
          sourceUrl: file.fullUrl,
          provider: "Wikimedia Commons",
          licenseSlug: file.licenseSlug,
          licenseUrl: file.licenseUrl,
          attributionRequired: file.attributionRequired,
          artist: file.artist,
          altText: `Nissan Z (${spec.name})`,
        },
        "GALLERY",
        GENERATIONS.indexOf(spec) + 1,
        gen.id,
      );
    } else {
      console.log(`  WARNING: photo lookup failed for ${spec.wikipediaTitle} ("${spec.image}")`);
    }

    const preferredYear = Math.min(spec.endYear ?? CURRENT_YEAR - 1, CURRENT_YEAR - 1);
    if (preferredYear >= spec.startYear) {
      try {
        const trims = await seedEpaTrimsForNameplate(gen.id, "Nissan", "Z", preferredYear);
        totalTrims += trims;
        console.log(`  ${spec.name}: ${trims} trims`);
      } catch (err) {
        console.log(`  ${spec.name}: EPA fetch skipped — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const overview = await prisma.generation.findFirst({ where: { carModelId: z.id, slug: "overview" } });
  if (overview) {
    const strandedTrims = await prisma.trim.count({ where: { generationId: overview.id } });
    const strandedPhotos = await prisma.carModelImage.count({ where: { generationId: overview.id } });
    if (strandedTrims === 0 && strandedPhotos === 0) {
      await prisma.generation.delete({ where: { id: overview.id } });
      console.log("  Deleted placeholder 'Overview' generation.");
    } else {
      console.log(`  NOT deleting 'Overview' — still has ${strandedTrims} trim(s)/${strandedPhotos} photo(s).`);
    }
  }

  console.log(`Backfilled: Nissan Z — ${GENERATIONS.length} generations, ${totalTrims} trims total.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
