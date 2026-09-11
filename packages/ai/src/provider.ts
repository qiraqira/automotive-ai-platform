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
  /** Real gap closed 2026-09-12, user's own explicit request ("проверяем
   * потом хорошей мощной моделью" — verify with a good, powerful
   * model): every real call in this codebase used to go through
   * createTextProvider()'s one hardcoded default (Haiku 4.5, the
   * cheapest model, picked for volume drafting) with no way for a
   * caller to ask for a stronger model on a specific, lower-volume,
   * higher-stakes call — the Fact Checker (apps/worker/src/fact-check.ts)
   * being the clearest real example: it re-checks an already-drafted
   * article against its sources, exactly the kind of call worth paying
   * more for a second, more careful opinion. Omit to keep the
   * provider's own default. */
  model?: string;
  /** Real gap closed 2026-09-12, user's own explicit request ("Каждый
   * раз гугли" — search every time): no AI call in this codebase could
   * ever see anything beyond the short excerpt(s) already sitting in
   * the database — the Writer and Fact Checker both worked from a
   * closed, static prompt with zero ability to check a claim against
   * the live web. `maxUses` bounds real, per-call cost (Anthropic's own
   * web search tool bills $10/1,000 searches, separate from token
   * cost — verified against platform.claude.com/docs/en/about-claude/pricing
   * before this was wired up) — omit `webSearch` entirely for a call
   * that shouldn't search at all (most calls still won't). */
  webSearch?: { maxUses?: number };
}

export interface CompletionResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  /** Real web searches Anthropic's own infrastructure actually
   * performed for this call (0 when `webSearch` wasn't requested, or
   * when the model chose not to search even though it could have) —
   * the real number a caller needs for accurate cost accounting,
   * distinct from tokensIn/tokensOut. */
  webSearchCount?: number;
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
