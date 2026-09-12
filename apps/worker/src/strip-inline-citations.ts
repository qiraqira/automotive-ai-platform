import { prisma } from "@automotive/database";
import { stripInlineCitations } from "./citation-cleanup.js";

// Real, recurring cleanup (first run 2026-09-12, re-run same day after
// the user found it live again on a freshly-written article): GPT-5.6
// Luna's raw web-search citation format keeps leaking into prose even
// after the writer prompt was told not to include it — the prompt-level
// instruction reduces but doesn't reliably eliminate " ([site.com]
// (https://...?utm_source=openai))" showing up in the drafted text.
// This platform's article page renders TEXT blocks as plain text, not
// markdown, so that syntax shows up literally and unreadable on the
// live page instead of as a link. Every real writer call site now runs
// stripInlineCitations() on its own output before saving (see
// citation-cleanup.ts), so going forward this should find nothing new —
// this script stays as a manual sweep for anything written before that
// backstop existed, or by a path that isn't covered.

async function main() {
  const blocks = await prisma.articleBlock.findMany({ where: { type: "TEXT" } });
  let changed = 0;
  for (const block of blocks) {
    const text = (block.data as { text?: string }).text;
    if (!text) continue;
    const cleaned = stripInlineCitations(text);
    if (cleaned === text) continue;
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
