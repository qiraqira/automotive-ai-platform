import type { AIProvider, CompletionRequest, CompletionResult, EmbeddingRequest, EmbeddingResult } from "../provider.js";

/**
 * A provider that does no network calls and costs nothing — used in tests
 * and local dev when no AI_API_KEY is configured, so the ingestion/pipeline
 * plumbing can be exercised without spending money or requiring a key. Not
 * a stand-in for a real writer/researcher stage in production; those need
 * a real provider (Anthropic/OpenAI) configured via packages/config.
 */
export class NullProvider implements AIProvider {
  readonly name = "null";

  async complete(_request: CompletionRequest): Promise<CompletionResult> {
    return { text: "", tokensIn: 0, tokensOut: 0, model: "null" };
  }

  async embed(_request: EmbeddingRequest): Promise<EmbeddingResult> {
    return { embedding: [], tokensIn: 0, model: "null" };
  }
}
