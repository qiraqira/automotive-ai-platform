import { readFile } from "node:fs/promises";
import { prisma } from "@automotive/database";

// One-shot CLI entrypoint (`npm run rewrite:article --workspace
// @automotive/worker -- <path-to-spec.json>`). Replaces an already-
// PUBLISHED article's own TEXT blocks and header fields with a fresh,
// human/session-written pass, while keeping every other block
// (SPEC_TABLE, IMAGE, VIDEO, ...) exactly where it is by re-numbering it
// to start right after the new paragraph count. Every call is a real,
// logged ArticleRevision — never a silent overwrite — per this project's
// own standing correction policy.
interface RewriteSpec {
  slug: string;
  headline?: string;
  subtitle?: string;
  // Explicit null removes the "Key takeaway:" box the article page
  // renders inline before the body (apps/web/src/app/articles/[locale]/
  // [slug]/page.tsx) — the exact "verdict before the article" shape the
  // 2026-09-19 editorial rewrite asked not to use. Omit the field
  // entirely to leave whatever's already there untouched.
  keyTakeaway?: string | null;
  paragraphs: string[];
  reason: string;
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: rewrite:article -- <spec.json>");
  const spec = JSON.parse(await readFile(path, "utf-8")) as RewriteSpec;

  const article = await prisma.article.findFirstOrThrow({ where: { slug: spec.slug, locale: "en" } });
  const existingBlocks = await prisma.articleBlock.findMany({ where: { articleId: article.id }, orderBy: { position: "asc" } });
  const oldTextBlocks = existingBlocks.filter((b) => b.type === "TEXT");
  const keptBlocks = existingBlocks.filter((b) => b.type !== "TEXT");

  const oldParagraphs = oldTextBlocks.map((b) => (b.data as { text: string }).text);

  await prisma.$transaction([
    prisma.articleBlock.deleteMany({ where: { articleId: article.id, type: "TEXT" } }),
    prisma.articleBlock.createMany({
      data: spec.paragraphs.map((text, position) => ({ articleId: article.id, type: "TEXT" as const, position, data: { text } })),
    }),
    ...keptBlocks.map((b, i) => prisma.articleBlock.update({ where: { id: b.id }, data: { position: spec.paragraphs.length + i } })),
    prisma.article.update({
      where: { id: article.id },
      data: {
        ...(spec.headline !== undefined ? { headline: spec.headline } : {}),
        ...(spec.subtitle !== undefined ? { subtitle: spec.subtitle } : {}),
        ...(spec.keyTakeaway !== undefined ? { keyTakeaway: spec.keyTakeaway } : {}),
        updatedAt: new Date(),
      },
    }),
    prisma.articleRevision.create({
      data: {
        articleId: article.id,
        authorType: "AI_AGENT",
        changeType: "rewrite",
        diff: { oldParagraphs, newParagraphs: spec.paragraphs, oldHeadline: article.headline, newHeadline: spec.headline ?? article.headline },
        reason: spec.reason,
      },
    }),
  ]);

  console.log(`"${spec.slug}": rewrote ${oldParagraphs.length} -> ${spec.paragraphs.length} paragraph(s), logged as an ArticleRevision.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
