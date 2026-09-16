import { prisma } from "@automotive/database";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

// Backfill batch 2, 2026-09-16 — the 12 car models media-health-check.ts
// still flagged with zero HERO photo after the Land Rover batch. Each
// source photo below was found via a real Commons search, downloaded,
// and looked at directly before writing this script (same standard as
// backfill-land-rover-photos.ts) — several first-pick candidates were
// rejected this pass for being interior-only shots, aftermarket
// widebody builds, or the wrong sibling model (Bronco Sport instead of
// Bronco), so this is not a blind first-hit automated match.
async function attach(brandSlug: string, modelSlug: string, spec: Parameters<typeof attachCarModelPhoto>[1]) {
  const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
  if (!brand) throw new Error(`${brandSlug} brand not found`);
  const model = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug } } });
  if (!model) throw new Error(`${brandSlug}/${modelSlug} not found`);
  await attachCarModelPhoto(model.id, spec, "HERO", 0);
  console.log(`${brandSlug}/${modelSlug}: done`);
}

async function main() {
  await attach("audi", "q5", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Audi%20Q5%20FY%20Facelift%20IMG%204139.jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc-by-sa-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true, artist: "Unknown (Commons)", altText: "Audi Q5 (FY, facelift)",
  });

  await attach("audi", "q8", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Audi%20Q8%20005.jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc-by-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0",
    attributionRequired: true, artist: "Unknown (Commons)", altText: "Audi Q8",
  });

  await attach("hyundai", "elantra", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/2024%20Hyundai%20Elantra%20N%20Line%20au%20SIAM%202024.jpg",
    provider: "Wikimedia Commons", licenseSlug: "pd", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    attributionRequired: false, artist: "Unknown (Commons)", altText: "Hyundai Elantra N Line",
  });

  await attach("ford", "ranger", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/2024%20Ford%20Ranger%20V6%20Limited%20(Argentina),%20side.jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc-by-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0",
    attributionRequired: true, artist: "Unknown (Commons)", altText: "Ford Ranger V6 Limited",
  });

  await attach("ford", "bronco", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Ford%20Bronco%20(6th%20generation)%20Badlands%20IMG%208611.jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc-by-sa-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true, artist: "Unknown (Commons)", altText: "Ford Bronco (6th generation) Badlands",
  });

  await attach("nissan", "z", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/2024%20Nissan%20Z%20Premium%20AT%20in%20Everest%20White,%20front%20right,%2007-21-2024.jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc-by-sa-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true, artist: "Unknown (Commons)", altText: "Nissan Z Premium (RZ34)",
  });

  await attach("toyota", "gr86", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/2024%20Toyota%20GR86%20-%20white.jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc-by-sa-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true, artist: "Unknown (Commons)", altText: "Toyota GR86",
  });

  await attach("subaru", "brz", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Subaru%20BRZ%20(ZD8)%20IMG%200771.jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc-by-sa-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true, artist: "Unknown (Commons)", altText: "Subaru BRZ (ZD8)",
  });

  await attach("mini", "cooper", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/MINI%20F56%20Hatch%20Cooper%20Blazing%20Red%20(36).jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc-by-sa-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true, artist: "Unknown (Commons)", altText: "Mini Cooper Hatch (F56)",
  });

  await attach("gmc", "sierra", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/GMC%20Sierra%201500%20Denali%206.2L%20Crew%20Cab%20GMTT1XX%20Avalon%20White%20Pearl%20(7).jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc-by-sa-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true, artist: "Unknown (Commons)", altText: "GMC Sierra 1500 Denali",
  });

  await attach("gmc", "yukon", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/25%20GMC%20Yukon%20Denali.jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false, artist: "Unknown (Commons)", altText: "GMC Yukon Denali",
  });

  await attach("gmc", "canyon", {
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/GMC%20Canyon%20AT4%20Crew%20Cab%20(2023)%20(53625710470).jpg",
    provider: "Wikimedia Commons", licenseSlug: "cc-by-2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0",
    attributionRequired: true, artist: "Unknown (Commons)", altText: "GMC Canyon AT4 Crew Cab",
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
