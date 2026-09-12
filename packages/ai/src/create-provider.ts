import { env } from "@automotive/config";
import type { AIProvider } from "./provider.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import { OpenAIProvider } from "./providers/openai-provider.js";
import { NullProvider } from "./providers/null-provider.js";

// A hardcoded model name like "claude-sonnet-5" is only valid against
// AnthropicProvider — passed to OpenAIProvider it would just be an
// invalid model string. This is the one place a caller like
// fact-check.ts (which deliberately wants a STRONGER model than the
// provider's own cheap default) can ask for that without hardcoding a
// provider-specific name — it stays in sync with whichever provider
// AI_DEFAULT_TEXT_PROVIDER actually selects.
//
// openai branch changed 2026-09-12, user's own explicit follow-up
// ("давай теперь все делать через дешевые модели openai... и проверять
// все через них" — do everything through OpenAI's cheap models now,
// including checking): plain "gpt-5" was tested and rejected (see
// openai-provider.ts's own DEFAULT_OPENAI_MODEL comment — it ignored
// the search cap and cost more per call than Sonnet 5 itself, the
// opposite of the goal). GPT-5.6 Luna already proved itself on real
// writing output in that same test, so it's used for both roles here
// rather than reaching for a second, pricier OpenAI tier the user
// didn't ask for.
export function getStrongModelName(): string {
  return env.AI_DEFAULT_TEXT_PROVIDER === "openai" ? "gpt-5.6-luna" : "claude-sonnet-5";
}

// The one place that turns AI_DEFAULT_TEXT_PROVIDER + the matching API key
// (packages/config) into a real AIProvider instance — pipeline stages ask
// this for a provider rather than importing a concrete provider class
// directly, so which provider handles text stays configuration, per
// docs/ai-pipeline.md "AIProvider abstraction". Falls back to NullProvider
// (no network calls, costs nothing) whenever no real key is configured —
// same "safe by default" posture as every other AI_* flag in this project
// (see packages/config's AI_KILL_SWITCH history) rather than throwing and
// blocking local dev/tests that never configured a key.
//
// "openai" branch added 2026-09-12, user's own explicit request to
// evaluate OpenAI as a cheaper alternative for the same Writer/
// Fact-Checker roles — real prices checked before offering this as a
// switch, not assumed cheaper.
export function createTextProvider(): AIProvider {
  if (env.AI_DEFAULT_TEXT_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(env.ANTHROPIC_API_KEY);
  }
  if (env.AI_DEFAULT_TEXT_PROVIDER === "openai" && env.OPENAI_API_KEY) {
    return new OpenAIProvider(env.OPENAI_API_KEY);
  }
  return new NullProvider();
}
