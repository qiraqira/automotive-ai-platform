import { prisma } from "@automotive/database";
import { attachHeroImage } from "./fetch-images.js";

// One-shot CLI entrypoint (`npm run replace:ai-images --workspace apps/worker`).
//
// Direct user request (architecture-restructuring plan, "Image system":
// find existing AI-generated photos and replace them where they read as
// a real photo of a real vehicle/event; never delete an article over a
// bad image). Real, current scale of the problem, queried live 2026-09-11:
// 121 of this DB's 284 real Image rows (43%) are AI_GENERATED — far more
// than the "a handful of stragglers" this might sound like from the name.
//
// Distinct from backfill-images.ts, which only ever touches an Article
// with ZERO hero image — every one of these 121 already has an
// AI_GENERATED HERO image, so that script's own `images: { none: ... } }`
// filter always skips them. This one specifically targets Articles whose
// current HERO image has `generatedByAi: true` and tries the real
// Commons/Openverse search + brand-logo fallback (fetch-images.ts's
// attachHeroImage(), the same pipeline every new article already uses)
// against them.
//
// Real vs when the corpus was first written: the brand-logo fallback
// (fetch-images.ts's searchBrandLogo()) didn't exist yet for most of
// this corpus's original writing pass — many of today's 121 AI images
// may have a real brand-logo alternative available now that wasn't
// tried before. Never silently drops the article to no-image: captures
// the existing AI ArticleImage row before attempting a replacement, and
// restores it verbatim if no real replacement is actually found (a
// temporarily-missing hero image on a real article is a worse outcome
// than keeping the AI one) — attachHeroImage() only ever ADDS a new
// ArticleImage row, it doesn't know to remove an old one, so this script
// owns that removal/restoration itself.
const BATCH_SIZE = Number(process.env.REPLACE_AI_IMAGES_BATCH_SIZE ?? 20);

async function main() {
  const candidates = await prisma.article.findMany({
    where: { images: { some: { role: "HERO", image: { generatedByAi: true } } } },
    orderBy: { createdAt: "desc" },
    take: BATCH_SIZE,
    select: {
      id: true,
      headline: true,
      story: { select: { title: true } },
      images: { where: { role: "HERO" }, take: 1 },
    },
  });

  console.log(`Found ${candidates.length} Article(s) with an AI-generated hero image (batch size ${BATCH_SIZE}).`);

  let replaced = 0;
  let keptAi = 0;
  for (const article of candidates) {
    const oldHero = article.images[0];
    if (!oldHero) continue; // structurally shouldn't happen given the `where` above

    try {
      await prisma.articleImage.delete({ where: { id: oldHero.id } });
      const searchTexts = article.story ? [article.story.title, article.headline] : [article.headline];
      const foundReal = await attachHeroImage(article.id, searchTexts);

      if (foundReal) {
        replaced++;
        console.log(`✓ replaced AI image with a real one: ${article.headline}`);
      } else {
        // No real replacement found (even the brand-logo fallback) —
        // restore the exact AI ArticleImage row rather than leave the
        // article with no hero image at all.
        await prisma.articleImage.create({
          data: { articleId: article.id, imageId: oldHero.imageId, role: oldHero.role, position: oldHero.position, altText: oldHero.altText },
        });
        keptAi++;
        console.log(`- kept existing AI image, no real replacement found: ${article.headline}`);
      }
    } catch (err) {
      console.error(`✗ error processing "${article.headline}":`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Done: ${replaced} replaced with a real photo, ${keptAi} kept as AI-generated (no real alternative found).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
