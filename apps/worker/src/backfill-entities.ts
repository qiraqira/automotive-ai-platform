import { XMLParser } from "fast-xml-parser";
import { prisma } from "@automotive/database";

// One-shot CLI entrypoint (`npm run backfill:entities`) — fixes real,
// already-ingested rows affected by rss.ts's own real bug (see that
// file's comment): titles/excerpts ingested before `htmlEntities: true`
// was added carry literal, undecoded entities like "&#8217;" instead of
// "'". Reuses the exact same fast-xml-parser decoding logic rss.ts now
// uses (wrap the string as a fake XML text node, parse, unwrap) rather
// than reimplementing an entity table — guarantees identical decoding
// behavior for both the fix-going-forward and the fix-for-existing-rows
// halves of this bug.
const parser = new XMLParser({ htmlEntities: true });

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  try {
    const result = parser.parse(`<x>${text}</x>`) as { x?: unknown };
    return typeof result.x === "string" ? result.x : text;
  } catch {
    // Malformed as a fake XML fragment (e.g. a bare "<" or "&" not part
    // of a real entity) — leave the original text untouched rather than
    // risk corrupting it.
    return text;
  }
}

async function fixField<T extends { id: string }>(
  label: string,
  rows: (T & Record<string, unknown>)[],
  field: string,
  update: (id: string, value: string) => Promise<unknown>,
): Promise<number> {
  let fixed = 0;
  for (const row of rows) {
    const original = row[field] as string;
    const decoded = decodeEntities(original);
    if (decoded !== original) {
      await update(row.id, decoded);
      fixed++;
      console.log(`${label} ${row.id}: "${original}" -> "${decoded}"`);
    }
  }
  return fixed;
}

async function main() {
  const stories = await prisma.story.findMany({ where: { title: { contains: "&" } }, select: { id: true, title: true } });
  const storiesFixed = await fixField("Story.title", stories, "title", (id, title) => prisma.story.update({ where: { id }, data: { title } }));

  const storiesWithSummary = await prisma.story.findMany({ where: { summary: { contains: "&" } }, select: { id: true, summary: true } });
  const summariesFixed = await fixField("Story.summary", storiesWithSummary as { id: string; summary: string }[], "summary", (id, summary) =>
    prisma.story.update({ where: { id }, data: { summary } }),
  );

  const sourceArticles = await prisma.sourceArticle.findMany({ where: { title: { contains: "&" } }, select: { id: true, title: true } });
  const sourceArticlesFixed = await fixField("SourceArticle.title", sourceArticles, "title", (id, title) =>
    prisma.sourceArticle.update({ where: { id }, data: { title } }),
  );

  const sourceArticlesWithExcerpt = await prisma.sourceArticle.findMany({ where: { excerpt: { contains: "&" } }, select: { id: true, excerpt: true } });
  const excerptsFixed = await fixField("SourceArticle.excerpt", sourceArticlesWithExcerpt as { id: string; excerpt: string }[], "excerpt", (id, excerpt) =>
    prisma.sourceArticle.update({ where: { id }, data: { excerpt } }),
  );

  console.log(`Done: ${storiesFixed} Story.title, ${summariesFixed} Story.summary, ${sourceArticlesFixed} SourceArticle.title, ${excerptsFixed} SourceArticle.excerpt fixed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
