import { prisma } from "@automotive/database";
import { fetchCommonsFileInfo } from "./lib/commons-search.js";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "chevrolet" } });
  const malibu = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand!.id, slug: "malibu" } } });
  const third = await prisma.generation.findFirst({ where: { carModelId: malibu!.id, slug: "third-generation-chevelle-malibu-1973" } });
  if (!third) throw new Error("Third generation not found");

  const file = await fetchCommonsFileInfo("1973 Chevelle Malibu SS.jpg");
  if (!file) throw new Error("Commons lookup failed");
  await attachCarModelPhoto(
    malibu!.id,
    {
      sourceUrl: file.fullUrl,
      provider: "Wikimedia Commons",
      licenseSlug: file.licenseSlug,
      licenseUrl: file.licenseUrl,
      attributionRequired: file.attributionRequired,
      artist: file.artist,
      altText: "Chevrolet Malibu (Third generation, Chevelle Malibu SS), 1973",
    },
    "GALLERY",
    10,
    third.id,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
