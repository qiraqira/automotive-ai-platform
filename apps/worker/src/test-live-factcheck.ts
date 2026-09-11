import { prisma } from "@automotive/database";
import { qualityGateThresholds } from "@automotive/config";
import { factCheckArticle } from "./fact-check.js";

// One-off live verification (2026-09-12): confirm the real, deployed
// fact-check.ts (Sonnet 5 + web search) works end-to-end against a real
// existing draft article, not just the earlier isolated
// test-websearch-combo.ts script.
async function main() {
  const article = await prisma.article.findFirst({
    where: { status: "DRAFT" },
    orderBy: { createdAt: "desc" },
    include: { blocks: { where: { type: "TEXT" }, orderBy: { position: "asc" } }, citations: true },
  });
  if (!article) throw new Error("No DRAFT article found.");

  const paragraphs = article.blocks.map((b) => (b.data as { text?: string }).text ?? "");
  const sourcesBlock = article.citations.map((c, i) => `${i + 1}. ${c.label}`).join("\n");

  console.log(`Testing fact-check on: "${article.headline}"`);
  const result = await factCheckArticle(article.id, article.headline, article.subtitle, paragraphs, sourcesBlock, qualityGateThresholds);
  console.log("RESULT:", JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
