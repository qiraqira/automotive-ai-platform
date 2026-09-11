import { env } from "@automotive/config";
import { OpenAIProvider } from "@automotive/ai";

// One-off empirical test (2026-09-12): confirm the new OpenAIProvider
// actually works — structured JSON output + web search together via
// the real Responses API — before switching any real pipeline traffic
// to it. Same discipline as the earlier Anthropic web-search-combo
// test (removed after it confirmed working).
async function main() {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const provider = new OpenAIProvider(env.OPENAI_API_KEY, "gpt-5");
  const result = await provider.complete({
    system: "You are a helpful research assistant. Use web search to find the real, current answer.",
    prompt: "What is the current real-world EPA electric range of the 2024 BMW X5 plug-in hybrid trim, in miles? Search the web to confirm the exact current trim name too.",
    responseSchema: {
      type: "object",
      properties: {
        rangeMiles: { type: "number", description: "The EPA electric range in miles" },
        trimName: { type: "string", description: "The current real trim name" },
        source: { type: "string", description: "Where this figure came from" },
      },
      required: ["rangeMiles", "trimName", "source"],
      additionalProperties: false,
    },
    webSearch: { maxUses: 1 },
    maxTokens: 2048,
  });
  console.log("RESULT TEXT:", result.text);
  console.log("WEB SEARCH COUNT:", result.webSearchCount);
  console.log("TOKENS IN/OUT:", result.tokensIn, result.tokensOut);
  console.log("MODEL:", result.model);
  try {
    console.log("PARSED OK:", JSON.parse(result.text));
  } catch (err) {
    console.log("PARSE FAILED:", err instanceof Error ? err.message : err);
  }

  // Also confirm real embeddings work.
  const emb = await provider.embed({ input: "BMW X5 plug-in hybrid" });
  console.log("EMBEDDING LENGTH:", emb.embedding.length, "MODEL:", emb.model);
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exitCode = 1;
});
