import { prisma } from "@automotive/database";

// One-shot CLI (`npm run link:car-model --workspace @automotive/worker --
// <articleSlug> <brandSlug>/<modelSlug>`). Small, reusable fix for the
// exact gap comparison-media-audit.ts flags as "NOT LINKED TO EXACTLY 2
// CAR MODELS" — an ArticleCarModel row missing even though the article's
// own text/photos are genuinely about that car (found first on "Ford
// F-150 vs. F-150 Lightning", which only had the gas F-150 linked).
async function main() {
  const [slug, pair] = process.argv.slice(2);
  if (!slug || !pair) {
    console.error("Usage: npm run link:car-model --workspace @automotive/worker -- <articleSlug> <brandSlug>/<modelSlug>");
    process.exitCode = 1;
    return;
  }
  const [brandSlug, modelSlug] = pair.split("/");
  const article = await prisma.article.findFirst({ where: { slug } });
  if (!article) throw new Error(`article "${slug}" not found`);
  const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
  if (!brand) throw new Error(`brand "${brandSlug}" not found`);
  const carModel = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug! } } });
  if (!carModel) throw new Error(`car model "${pair}" not found`);

  await prisma.articleCarModel.upsert({
    where: { articleId_carModelId: { articleId: article.id, carModelId: carModel.id } },
    update: {},
    create: { articleId: article.id, carModelId: carModel.id },
  });
  console.log(`Linked "${slug}" <-> ${brand.name} ${carModel.name}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
