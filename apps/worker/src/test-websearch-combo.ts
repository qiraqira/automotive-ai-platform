import { env } from "@automotive/config";
import { createTextProvider } from "@automotive/ai";

// One-off empirical test (2026-09-12): does combining Anthropic's
// web_search tool with a structured json_schema output_config actually
// work in one call, or does the API reject/ignore one of them? Real
// question before wiring this into fact-check.ts/write-article.ts for
// real — not assumed from the type definitions alone.
async function main() {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const provider = createTextProvider();
  const result = await provider.complete({
    system: "You are a helpful research assistant. Use web search to find the real, current answer.",
    prompt: "What is the current real-world EPA electric range of the 2024 BMW X5 xDrive45e plug-in hybrid, in miles? Search the web to confirm.",
    responseSchema: {
      type: "object",
      properties: {
        rangeMiles: { type: "number", description: "The EPA electric range in miles" },
        source: { type: "string", description: "Where this figure came from" },
      },
      required: ["rangeMiles", "source"],
      additionalProperties: false,
    },
    model: "claude-sonnet-5",
    webSearch: { maxUses: 3 },
    maxTokens: 1024,
  });
  console.log("RESULT TEXT:", result.text);
  console.log("WEB SEARCH COUNT:", result.webSearchCount);
  console.log("TOKENS IN/OUT:", result.tokensIn, result.tokensOut);
  console.log("MODEL:", result.model);
  try {
    const parsed = JSON.parse(result.text);
    console.log("PARSED OK:", parsed);
  } catch (err) {
    console.log("PARSE FAILED:", err instanceof Error ? err.message : err);
  }
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exitCode = 1;
});
