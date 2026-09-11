import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, CompletionRequest, CompletionResult, EmbeddingRequest, EmbeddingResult } from "../provider.js";

// Real Anthropic (Claude) text-completion provider — see docs/ai-pipeline.md
// "AIProvider abstraction". Defaults to Haiku 4.5 (`claude-haiku-4-5`), the
// cheapest current Claude model, since this platform's pipeline calls it at
// volume (classification/drafts across every ingested Story) and cost is
// bounded per-request by `assertWithinBudget()`/`AI_DAILY_BUDGET_USD` at the
// call site, not inside this provider — the provider stays a thin adapter,
// same separation of concerns as NullProvider.
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model: string = DEFAULT_ANTHROPIC_MODEL, client?: Anthropic) {
    this.client = client ?? new Anthropic({ apiKey });
    this.model = model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = request.model ?? this.model;
    const response = await this.client.messages.create({
      model,
      max_tokens: request.maxTokens ?? 4096,
      ...(request.system !== undefined ? { system: request.system } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      // Raw JSON Schema output constraint (spec §87 "structured AI output")
      // — verified against the installed SDK's own JSONOutputFormat type
      // (`{type: "json_schema", schema}`) rather than assumed; the text
      // block below still carries the raw JSON string, the caller parses
      // it — this provider doesn't use client.messages.parse()'s
      // Zod-only parsed_output path since responseSchema is a plain
      // JSON-schema object, not a Zod schema. Real constraint found live
      // 2026-09-08 (apps/worker/src/write-article.ts's first real call):
      // the API rejects an array's `minItems`/`maxItems` unless it's 0 or
      // 1 — "For 'array' type, 'minItems' values other than 0 or 1 are
      // not supported" — express a desired array length range in the
      // field's `description` instead, not as a schema constraint.
      ...(request.responseSchema !== undefined
        ? { output_config: { format: { type: "json_schema" as const, schema: request.responseSchema } } }
        : {}),
      // Anthropic's own server-side web search tool (verified against the
      // installed SDK's WebSearchTool20250305 type before using it) —
      // the search itself executes on Anthropic's infrastructure inside
      // this one call (no client-side agentic loop needed): the model
      // emits a `server_tool_use` block, Anthropic runs the real search
      // and appends a `web_search_tool_result` block, and the model then
      // writes its final answer as a further text block, all in the same
      // response. `max_uses` bounds real per-call search cost.
      ...(request.webSearch
        ? { tools: [{ name: "web_search" as const, type: "web_search_20250305" as const, max_uses: request.webSearch.maxUses ?? 3 }] }
        : {}),
      messages: [{ role: "user", content: request.prompt }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error(`Anthropic refused the request (model ${model}): ${response.stop_details?.category ?? "unknown category"}`);
    }

    // The LAST text block, not the first: when web search runs, the
    // content array interleaves `server_tool_use`/`web_search_tool_result`
    // blocks between an initial text block (e.g. "Let me check that") and
    // the model's real final answer — taking the first text block would
    // silently return the wrong (incomplete) content whenever a search
    // actually happened.
    const textBlocks = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text");
    const textBlock = textBlocks.at(-1);
    if (!textBlock) {
      throw new Error(`Anthropic response for model ${model} contained no text block (stop_reason: ${response.stop_reason})`);
    }

    return {
      text: textBlock.text,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      model: response.model,
      webSearchCount: response.usage.server_tool_use?.web_search_requests ?? 0,
    };
  }

  // Anthropic has no embeddings API — AI_DEFAULT_EMBEDDING_PROVIDER is
  // documented (packages/config/.env.example) as "openai" for exactly this
  // reason. Throwing here (rather than silently returning an empty vector)
  // makes a misconfigured embedding call fail loudly instead of corrupting
  // real vector-search data with zero vectors.
  async embed(_request: EmbeddingRequest): Promise<EmbeddingResult> {
    throw new Error("AnthropicProvider does not support embeddings — Anthropic has no embeddings API. Configure the embedding provider (AI_DEFAULT_EMBEDDING_PROVIDER) separately, e.g. OpenAI.");
  }
}
