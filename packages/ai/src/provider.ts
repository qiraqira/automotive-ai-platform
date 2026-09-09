// The one interface every pipeline stage talks to — see docs/ai-pipeline.md
// "AIProvider abstraction". Concrete providers (Anthropic, OpenAI, a future
// local model) implement this; which provider handles which stage is
// configuration (packages/config), never a hardcoded import in a pipeline
// stage file.

export interface CompletionRequest {
  system?: string;
  prompt: string;
  /** JSON schema the response must validate against — see spec §87
   * "structured AI output". Omit only for genuinely freeform text. */
  responseSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export interface EmbeddingRequest {
  input: string;
}

export interface EmbeddingResult {
  embedding: number[];
  tokensIn: number;
  model: string;
}

export interface AIProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}
