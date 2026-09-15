import { prisma } from "@automotive/database";
import { fetchCommonsFileInfo } from "./lib/commons-search.js";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "chevrolet" } });
  const bolt = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand!.id, slug: "bolt-ev" } } });
  const first = await prisma.generation.findFirst({ where: { carModelId: bolt!.id, slug: "first-generation" } });
  if (!first) throw new Error("First generation not found");

  const file = await fetchCommonsFileInfo("2017 Chevrolet Bolt EV Premier front 6.20.18.jpg");
  if (!file) throw new Error("Commons lookup failed");
  await attachCarModelPhoto(
    bolt!.id,
    {
      sourceUrl: file.fullUrl,
      provider: "Wikimedia Commons",
      licenseSlug: file.licenseSlug,
      licenseUrl: file.licenseUrl,
      attributionRequired: file.attributionRequired,
      artist: file.artist,
      altText: "Chevrolet Bolt EV (First generation), 2017",
    },
    "HERO",
    0,
    first.id,
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
