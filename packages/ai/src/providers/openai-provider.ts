import type { AIProvider, CompletionRequest, CompletionResult, EmbeddingRequest, EmbeddingResult } from "../provider.js";

// Real OpenAI text-completion provider, added 2026-09-12 — user's own
// explicit request to evaluate OpenAI as a cheaper alternative for the
// same Writer/Fact-Checker roles AnthropicProvider already serves.
// Raw fetch() to the Responses API (no SDK), same posture this
// codebase already uses for its other OpenAI calls (apps/worker/src/
// verify-image.ts, generate-image.ts, embed.ts) — one lightweight
// endpoint doesn't need a dependency.
//
// Default changed 2026-09-12 after a real, live A/B test (not a
// theoretical pricing comparison): gave the exact same real Story +
// sources to Claude Haiku 4.5, GPT-5-mini, and GPT-5.6 Luna. Haiku
// couldn't even run (Anthropic account genuinely out of credit at the
// time), but the real, already-published Haiku article for that same
// story had been flagged by the corpus audit for omitting real,
// available specifics (plant location, interior tech, comparisons).
// Both OpenAI candidates included nearly everything the audit said was
// missing. GPT-5.6 Luna won on cost too — $0.20/$1.20 per 1M input/
// output tokens (cheaper than GPT-5-mini's $0.25/$2, both far below
// Haiku's $1/$5) — real cost on that test run: ~$0.025 for a
// noticeably more detailed article. Plain "gpt-5" was tested and
// rejected separately: it's a reasoning model that ignored the
// intended search cap (9 real searches on a 1-search request) and
// spent most of its token budget on internal reasoning, ending up
// MORE expensive per call (~$0.16) than Sonnet 5's own real average
// ($0.07) — the opposite of the goal.
export const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";

interface ResponsesApiOutputTextContent {
  type: "output_text";
  text: string;
}
interface ResponsesApiRefusalContent {
  type: "refusal";
  refusal: string;
}
interface ResponsesApiMessageItem {
  type: "message";
  content: (ResponsesApiOutputTextContent | ResponsesApiRefusalContent)[];
}
interface ResponsesApiWebSearchCallItem {
  type: "web_search_call";
}
type ResponsesApiOutputItem = ResponsesApiMessageItem | ResponsesApiWebSearchCallItem | { type: string };

interface ResponsesApiResponse {
  model: string;
  output: ResponsesApiOutputItem[];
  usage?: { input_tokens: number; output_tokens: number };
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string = DEFAULT_OPENAI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = request.model ?? this.model;
    const input = [
      ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
      { role: "user" as const, content: request.prompt },
    ];

    const body: Record<string, unknown> = {
      model,
      input,
      max_output_tokens: request.maxTokens ?? 4096,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.responseSchema !== undefined
        ? { text: { format: { type: "json_schema", name: "response", schema: request.responseSchema, strict: true } } }
        : {}),
      // Real gap, disclosed honestly rather than silently ignored:
      // unlike Anthropic's web_search_20250305 tool, OpenAI's own
      // `web_search` tool takes no per-call max-uses cap in its request
      // shape (verified against developers.openai.com/api/docs/guides/
      // tools-web-search before assuming otherwise) — `webSearch.maxUses`
      // is accepted for interface compatibility with AnthropicProvider
      // but has no effect here; the model decides how many searches a
      // turn needs on its own.
      ...(request.webSearch ? { tools: [{ type: "web_search" }] } : {}),
    };

    const res = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OpenAI Responses API returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as ResponsesApiResponse;

    const messageItem = data.output.find((item): item is ResponsesApiMessageItem => item.type === "message");
    const textContent = messageItem?.content.find((c): c is ResponsesApiOutputTextContent => c.type === "output_text");
    const refusalContent = messageItem?.content.find((c): c is ResponsesApiRefusalContent => c.type === "refusal");
    if (refusalContent) {
      throw new Error(`OpenAI refused the request (model ${model}): ${refusalContent.refusal}`);
    }
    if (!textContent) {
      throw new Error(`OpenAI response for model ${model} contained no output_text (output types: ${data.output.map((o) => o.type).join(", ")})`);
    }

    const webSearchCount = data.output.filter((item) => item.type === "web_search_call").length;

    return {
      text: textContent.text,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
      model: data.model,
      webSearchCount,
    };
  }

  // Real embeddings call — unlike AnthropicProvider, OpenAI actually has
  // an embeddings API, so this is genuinely implemented rather than
  // thrown. Same model apps/worker/src/embed.ts already uses directly
  // for story-clustering, kept consistent rather than picking a second
  // embedding model for the same provider.
  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const res = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: request.input }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings API returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as { data?: { embedding: number[] }[]; usage?: { prompt_tokens: number }; model: string };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) {
      throw new Error(`OpenAI embeddings response contained no embedding`);
    }
    return { embedding, tokensIn: data.usage?.prompt_tokens ?? 0, model: data.model };
  }
}
