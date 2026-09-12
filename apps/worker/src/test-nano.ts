import { prisma } from "@automotive/database";
import { env } from "@automotive/config";
import { OpenAIProvider } from "@automotive/ai";
import { factCheckArticle } from "./fact-check.js";
import { qualityGateThresholds } from "@automotive/config";

// Real, user-requested test (2026-09-12): try gpt-5-nano ($0.05/$0.40,
// 4x cheaper than gpt-5.6-luna's $0.20/$1.20) on the exact same real
// stories Luna already wrote well for during the live regeneration
// batch — direct, apples-to-apples comparison against Luna's own real,
// already-recorded scores, not a fresh unrelated story.

const STORY_IDS = [
  { id: "cmtse23id00lusyqmgc7yb6b3", lunaScore: 87.4, lunaHeadline: "Labor Day deals put Segway ZT3 Pro scooter at $850" },
  { id: "cmtsgqig100mcsyqmdje9boy0", lunaScore: 91.6, lunaHeadline: "BMW Expands Opt-In iX3 Data Program Across Europe" },
  { id: "cmtsnpabo0000m0r0hecj8rmk", lunaScore: 69.4, lunaHeadline: "LED Technology Gives Round Headlights a Second Life" },
];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "A concise, factual news headline, under 100 characters." },
    subtitle: { type: "string", description: "One sentence expanding on the headline." },
    keyTakeaway: { type: "string", description: "The single most important fact, in one sentence." },
    paragraphs: {
      type: "array",
      items: { type: "string" },
      description: "The article body, as 4 to 8 original paragraphs of plain prose (no markdown) — long enough to actually use whatever real additional context was found, never padded just to hit a count.",
    },
  },
  required: ["headline", "subtitle", "keyTakeaway", "paragraphs"],
  additionalProperties: false,
};

const SYSTEM =
  "You are a factual automotive news writer for an editorial platform with real web search available, whose core rule is: never reproduce a source's wording, only synthesize real facts into original prose. Stay strictly within the facts given or found via a real search — never invent a spec, date, price, or quote. Neutral, concise, journalistic tone, but genuinely informative rather than a bare rewrite of the shortest possible summary. Write plain prose paragraphs only — do NOT include inline hyperlinks, markdown link syntax like ([site.com](url)), or citation markers in the paragraph text itself; sourcing is tracked separately by this platform, not inline in the prose. Respond with JSON matching the given schema, and nothing else.";

async function main() {
  const provider = new OpenAIProvider(env.OPENAI_API_KEY!, "gpt-5-nano");

  for (const target of STORY_IDS) {
    const story = await prisma.story.findUnique({
      where: { id: target.id },
      select: {
        title: true,
        summary: true,
        sourceArticles: { take: 5, orderBy: { fetchedAt: "desc" }, select: { title: true, excerpt: true, source: { select: { name: true } } } },
      },
    });
    if (!story) {
      console.log(`- Story ${target.id} not found, skipping.`);
      continue;
    }

    const sourcesBlock = story.sourceArticles.map((a, i) => `${i + 1}. [${a.source.name}] "${a.title}"${a.excerpt ? ` — ${a.excerpt}` : ""}`).join("\n");
    const prompt = `Story title: ${story.title}
${story.summary ? `Known summary: ${story.summary}\n` : ""}
Source headlines/excerpts (real ground truth from this platform's own ingestion):
${sourcesBlock}

Before writing, use web search to find genuinely new, real, current context beyond what's in the sources above. Only search for something that would actually change or enrich what you write. Never copy any source's wording verbatim, never fabricate a fact. Write a real, original automotive-news article synthesizing all of it.`;

    console.log(`\n\n========== ${story.title} (Luna scored ${target.lunaScore}) ==========`);
    try {
      const start = Date.now();
      const completion = await provider.complete({
        system: SYSTEM,
        prompt,
        responseSchema: RESPONSE_SCHEMA,
        webSearch: { maxUses: 1 },
        maxTokens: 4096,
      });
      const ms = Date.now() - start;
      const parsed = JSON.parse(completion.text) as { headline: string; subtitle: string; keyTakeaway: string; paragraphs: string[] };
      console.log(`Model: ${completion.model} | ${ms}ms | tokens ${completion.tokensIn}/${completion.tokensOut} | searches: ${completion.webSearchCount ?? 0}`);
      const costUsd = (completion.tokensIn / 1_000_000) * 0.05 + (completion.tokensOut / 1_000_000) * 0.4 + (completion.webSearchCount ?? 0) * 0.01;
      console.log(`Real cost: $${costUsd.toFixed(4)}`);
      console.log("Headline:", parsed.headline);
      parsed.paragraphs.forEach((p, i) => console.log(`  [${i + 1}] ${p}`));

      const newSourcesBlock = story.sourceArticles.map((a, i) => `${i + 1}. ${a.source.name}: ${a.title}`).join("\n");
      const fc = await factCheckArticle(`nano-test-${target.id}`, parsed.headline, parsed.subtitle, parsed.paragraphs, newSourcesBlock, qualityGateThresholds);
      if (fc) {
        console.log(`\nFACT-CHECK SCORE: ${fc.gate.overallScore.toFixed(1)} (verdict: ${fc.gate.verdict}) vs Luna's real ${target.lunaScore}`);
        console.log("Concerns:", fc.concerns);
      }
    } catch (err) {
      console.error(`FAILED for "${story.title}":`, err instanceof Error ? err.message : err);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
