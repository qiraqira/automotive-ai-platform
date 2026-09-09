import { prisma } from "@automotive/database";
import { classifyTopic } from "@automotive/editorial";

// One-shot CLI entrypoint (`npm run backfill:topics --workspace apps/worker`).
// Topic classification (this file's sibling `ingest.ts`) only runs at Story
// creation, so every Story ingested before that wiring landed has no
// primaryTopicId — not because it doesn't fit a topic, just because
// nothing ever classified it. Idempotent and safe to re-run any time
// TOPIC_RULES changes: only touches Stories with primaryTopicId still
// null, never overwrites an existing classification.
async function main() {
  const unclassified = await prisma.story.findMany({
    where: { primaryTopicId: null },
    select: { id: true, title: true },
  });
  console.log(`Found ${unclassified.length} unclassified stories.`);

  const topics = await prisma.topic.findMany();
  const topicIdBySlug = new Map(topics.map((t) => [t.slug, t.id]));

  const counts: Record<string, number> = {};
  for (const story of unclassified) {
    const slug = classifyTopic(story.title);
    if (!slug) {
      counts.unmatched = (counts.unmatched ?? 0) + 1;
      continue;
    }
    const topicId = topicIdBySlug.get(slug);
    if (!topicId) {
      // A rule references a slug with no seeded Topic row — a real
      // config mismatch, not silently ignorable.
      counts[`${slug} (no Topic row!)`] = (counts[`${slug} (no Topic row!)`] ?? 0) + 1;
      continue;
    }
    await prisma.story.update({ where: { id: story.id }, data: { primaryTopicId: topicId } });
    counts[slug] = (counts[slug] ?? 0) + 1;
  }

  console.log("Backfilled:", counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
