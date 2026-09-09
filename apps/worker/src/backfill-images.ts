import { prisma } from "@automotive/database";
import { attachHeroImage } from "./fetch-images.js";
import { generateHeroImage } from "./generate-image.js";

// One-shot CLI entrypoint (`npm run backfill:images`), same shape as
// backfill-topics.ts/backfill-authors.ts — real Wikimedia Commons search
// per Article, falling back to a real OpenAI gpt-image-1 generation
// (generate-image.ts) when free stock finds nothing (skipped
// automatically if OPENAI_API_KEY isn't set — see that file). Idempotent,
// only touches Articles with no HERO image yet.
const BATCH_SIZE = Number(process.env.BACKFILL_IMAGES_BATCH_SIZE ?? 20);

async function main() {
  const candidates = await prisma.article.findMany({
    where: { images: { none: { role: "HERO" } } },
    orderBy: { createdAt: "desc" },
    take: BATCH_SIZE,
    select: { id: true, headline: true, subtitle: true, story: { select: { title: true, primaryTopic: { select: { slug: true } } } } },
  });

  console.log(`Found ${candidates.length} Article(s) with no hero image yet (batch size ${BATCH_SIZE}).`);

  let attachedFree = 0;
  let generated = 0;
  let stillMissing = 0;
  for (const article of candidates) {
    try {
      const searchTexts = article.story ? [article.story.title, article.headline] : [article.headline];
      const foundFree = await attachHeroImage(article.id, searchTexts);
      if (foundFree) {
        attachedFree++;
        console.log(`✓ (free stock) ${article.headline}`);
        continue;
      }
      const gen = await generateHeroImage(article.id, article.headline, article.subtitle, article.story?.primaryTopic?.slug ?? null);
      if (gen) {
        generated++;
        console.log(`✓ (AI-generated) ${article.headline}`);
      } else {
        stillMissing++;
        console.log(`✗ no image (free stock or AI) for: ${article.headline}`);
      }
    } catch (err) {
      console.error(`✗ error fetching image for "${article.headline}":`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Done: ${attachedFree} free-stock, ${generated} AI-generated, ${stillMissing} still missing.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
