import { prisma } from "@automotive/database";
import { attachCarModelPhoto, type CarPhotoSpec } from "./lib/attach-car-photo.js";

// One-shot CLI entrypoint (`npm run backfill:gallery-photos --workspace
// @automotive/worker`). Retrofits a second, real, human-verified photo
// (role: GALLERY, position: 1) onto each of the four catalog entries
// this session shipped with only a single HERO photo — user's explicit
// ask (2026-09-13): every catalog entry and article should show more
// than one real photo where a genuine, differently-angled, correctly-
// licensed one exists. See lib/attach-car-photo.ts for the shared
// self-hosting logic (dedupes by sha256, same as every other photo path
// in this codebase); apps/web's car model page gained GALLERY rendering
// in this same pass (it only ever showed HERO before).

interface Job {
  brandSlug: string;
  modelSlug: string;
  photo: CarPhotoSpec;
}

const jobs: Job[] = [
  {
    brandSlug: "toyota",
    modelSlug: "corolla",
    photo: {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/b/b3/2021_Toyota_Corolla_LE%2C_front_right%2C_07-13-2024.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc-by-sa-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attributionRequired: true,
      artist: "MercurySable99",
      altText: "A grey 2021 Toyota Corolla LE, front three-quarter view",
    },
  },
  {
    brandSlug: "honda",
    modelSlug: "civic",
    photo: {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/6/61/2022_Honda_Civic_Sedan_EX_in_Platinum_White_Pearl%2C_front_left.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc-by-sa-3.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      attributionRequired: true,
      artist: "Mr.choppers",
      altText: "A white Honda Civic Sedan EX, eleventh generation, front three-quarter view",
    },
  },
  {
    brandSlug: "honda",
    modelSlug: "cr-v",
    photo: {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/1/1e/2023_Honda_CR-V_EX-L_AWD%2C_front_right%2C_11-13-2022.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc-by-sa-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attributionRequired: true,
      artist: "MercurySable99",
      altText: "A dark grey 2023 Honda CR-V EX-L, sixth generation, front three-quarter view",
    },
  },
  {
    brandSlug: "tesla",
    modelSlug: "model-3",
    photo: {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/6/66/2024_Tesla_Model_3_Highland_Performance_AWD_%28Rear%29.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc-by-sa-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attributionRequired: true,
      artist: "Chanokchon",
      altText: "A white Tesla Model 3 (Highland refresh), rear three-quarter view at an auto show",
    },
  },
];

async function main() {
  for (const job of jobs) {
    const brand = await prisma.brand.findUnique({ where: { slug: job.brandSlug } });
    if (!brand) {
      console.log(`Skipping ${job.brandSlug}/${job.modelSlug}: brand not found.`);
      continue;
    }
    const carModel = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: job.modelSlug } } });
    if (!carModel) {
      console.log(`Skipping ${job.brandSlug}/${job.modelSlug}: model not found.`);
      continue;
    }
    console.log(`${job.brandSlug}/${job.modelSlug}:`);
    await attachCarModelPhoto(carModel.id, job.photo, "GALLERY", 1);
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
