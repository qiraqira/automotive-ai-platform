import { prisma } from "@automotive/database";

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "ford" } });
  const explorer = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand!.id, slug: "explorer" } } });
  const images = await prisma.carModelImage.findMany({
    where: { carModelId: explorer!.id },
    include: { generation: true },
  });
  for (const img of images) {
    if (!img.generation) continue;
    const cleanAlt = `Ford Explorer (${img.generation.name})`;
    if (img.altText !== cleanAlt) {
      await prisma.carModelImage.update({ where: { id: img.id }, data: { altText: cleanAlt } });
      console.log(`[ok] "${img.altText}" -> "${cleanAlt}"`);
    }
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
