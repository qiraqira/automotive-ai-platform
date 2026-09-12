import { prisma } from "@automotive/database";

// One-off cleanup (2026-09-12): the first 3 real regeneration runs (via
// regenerate-news-articles.ts, before its prompt was fixed the same
// tick — see write-article.ts's own updated prompt comment) went live
// with GPT-5.6 Luna's raw web-search citation format still embedded in
// the prose: " ([site.com](https://...))" — this platform's article
// page renders TEXT blocks as plain text, not markdown, so that syntax
// was showing up literally on the live page instead of as a link.
// Strips exactly that pattern from every TEXT block site-wide (safe:
// real prose doesn't naturally produce "([domain](url))"), not just
// the 3 known-affected articles, in case any others slipped through.
const CITATION_PATTERN = / ?\(\[[^\]]+\]\(https?:\/\/[^)]+\)\)/g;

async function main() {
  const blocks = await prisma.articleBlock.findMany({ where: { type: "TEXT" } });
  let changed = 0;
  for (const block of blocks) {
    const text = (block.data as { text?: string }).text;
    if (!text || !CITATION_PATTERN.test(text)) continue;
    CITATION_PATTERN.lastIndex = 0;
    const cleaned = text.replace(CITATION_PATTERN, "").trim();
    await prisma.articleBlock.update({ where: { id: block.id }, data: { data: { text: cleaned } } });
    changed++;
    console.log(`✓ cleaned block ${block.id} (article ${block.articleId})`);
  }
  console.log(`Done: ${changed} of ${blocks.length} TEXT block(s) had inline citation syntax stripped.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
