import { prisma } from "@automotive/database";
import { env } from "@automotive/config";
import { AnthropicProvider, OpenAIProvider } from "@automotive/ai";

// Real, user-requested A/B/C test (2026-09-12): "Нужно взять одну и ту
// же реальную новость, дать её GPT-5.6, GPT-5-mini и Claude, а затем
// сравнить" — take one real story, give it to GPT-5.6, GPT-5-mini and
// Claude, then compare. Uses the exact Story that write-article.ts's
// own real Haiku 4.5 output was flagged for in the corpus audit
// ("omits nearly all specific, verifiable details... Louisville plant,
// Farley's tweet, RAV4 comparison, BlueCruise/Apple Maps") — real
// question: does a different model actually include what Haiku left
// out, given the exact same real source material?

const STORY_ID = "cmtse23b300ipsyqmcx47m301";

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
  "You are a factual automotive news writer for an editorial platform with real web search available, whose core rule is: never reproduce a source's wording, only synthesize real facts into original prose. Stay strictly within the facts given or found via a real search — never invent a spec, date, price, or quote. Neutral, concise, journalistic tone, but genuinely informative rather than a bare rewrite of the shortest possible summary. Respond with JSON matching the given schema, and nothing else.";

async function main() {
  const story = await prisma.story.findUnique({
    where: { id: STORY_ID },
    select: {
      title: true,
      summary: true,
      sourceArticles: { take: 5, orderBy: { fetchedAt: "desc" }, select: { title: true, excerpt: true, source: { select: { name: true } } } },
    },
  });
  if (!story) throw new Error("Story not found");

  const sourcesBlock = story.sourceArticles.map((a, i) => `${i + 1}. [${a.source.name}] "${a.title}"${a.excerpt ? ` — ${a.excerpt}` : ""}`).join("\n");
  const prompt = `Story title: ${story.title}
${story.summary ? `Known summary: ${story.summary}\n` : ""}
Source headlines/excerpts (real ground truth from this platform's own ingestion):
${sourcesBlock}

Before writing, use web search to find genuinely new, real, current context beyond what's in the sources above — other outlets' coverage of the same story, the real current spec/price/date if the story turns on one, or real relevant background. Only search for something that would actually change or enrich what you write; skip it if the sources above already fully cover the story. Never copy any source's wording verbatim, and never fabricate a fact beyond what the sources or a real search result actually state. Write a real, original automotive-news article synthesizing all of it.`;

  console.log("=== SOURCES ===\n" + sourcesBlock + "\n");

  const candidates: { label: string; provider: AnthropicProvider | OpenAIProvider; model: string }[] = [
    { label: "Claude Haiku 4.5 (current default)", provider: new AnthropicProvider(env.ANTHROPIC_API_KEY!), model: "claude-haiku-4-5" },
    { label: "GPT-5-mini", provider: new OpenAIProvider(env.OPENAI_API_KEY!), model: "gpt-5-mini" },
    { label: "GPT-5.6 Luna", provider: new OpenAIProvider(env.OPENAI_API_KEY!), model: "gpt-5.6-luna" },
  ];

  for (const c of candidates) {
    console.log(`\n\n========== ${c.label} ==========`);
    try {
      const start = Date.now();
      const result = await c.provider.complete({
        system: SYSTEM,
        prompt,
        responseSchema: RESPONSE_SCHEMA,
        model: c.model,
        webSearch: { maxUses: 1 },
        maxTokens: 8192,
      });
      const ms = Date.now() - start;
      const parsed = JSON.parse(result.text);
      console.log(`Model: ${result.model} | ${ms}ms | tokens in/out: ${result.tokensIn}/${result.tokensOut} | searches: ${result.webSearchCount ?? 0}`);
      console.log("Headline:", parsed.headline);
      console.log("Subtitle:", parsed.subtitle);
      console.log("Key takeaway:", parsed.keyTakeaway);
      console.log("Paragraphs:");
      parsed.paragraphs.forEach((p: string, i: number) => console.log(`  [${i + 1}] ${p}`));
    } catch (err) {
      console.error(`FAILED for ${c.label}:`, err instanceof Error ? err.message : err);
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
