import { prisma } from "@automotive/database";
import { computeImportanceScore } from "@automotive/editorial";

// One-shot CLI entrypoint (`npm run backfill:importance --workspace apps/worker`),
// same idempotent-backfill shape as `backfill-topics.ts`/`backfill-authors.ts`.
// `ingestSource()`'s real importanceScore computation (2026-09-07) only
// runs at the moment a new item is ingested, so every Story whose
// distinct-source count changed before that landed is still sitting on
// whatever score it had before — for nearly every real Story that's the
// harmless schema default (30, unaffected either way), but any Story that
// already had 2+ real distinct sources before today needs a one-time
// recompute to reflect that. Confirmed live before writing this: 149 real
// Stories in this dev DB, exactly 1 with 2+ sources, still stuck at 30.
async function main() {
  const stories = await prisma.story.findMany({ select: { id: true, importanceScore: true, _count: { select: { sources: true } } } });
  console.log(`Checking ${stories.length} real Stories for a stale importanceScore...`);

  let updated = 0;
  for (const story of stories) {
    const correct = computeImportanceScore(story._count.sources);
    if (correct !== story.importanceScore) {
      await prisma.story.update({ where: { id: story.id }, data: { importanceScore: correct } });
      updated += 1;
    }
  }

  console.log(`Backfilled ${updated} Story row(s) with a corrected importanceScore.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
