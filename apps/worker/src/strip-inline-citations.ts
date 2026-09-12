import { prisma } from "@automotive/database";

// Real, recurring cleanup (first run 2026-09-12, re-run same day after
// the user found it live again on a freshly-written article): GPT-5.6
// Luna's raw web-search citation format keeps leaking into prose even
// after the writer prompt was told not to include it — the prompt-level
// instruction reduces but doesn't reliably eliminate " ([site.com]
// (https://...?utm_source=openai))" showing up in the drafted text.
// This platform's article page renders TEXT blocks as plain text, not
// markdown, so that syntax shows up literally and unreadable on the
// live page instead of as a link. Strips exactly that pattern from
// every TEXT block site-wide (safe: real prose doesn't naturally
// produce "([domain](url))") and is meant to be re-run periodically —
// no API calls, pure text cleanup — for as long as the pipeline is
// paused and articles are being handled by hand.
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
