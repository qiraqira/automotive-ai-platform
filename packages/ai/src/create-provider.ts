import { env } from "@automotive/config";
import type { AIProvider } from "./provider.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import { NullProvider } from "./providers/null-provider.js";

// The one place that turns AI_DEFAULT_TEXT_PROVIDER + ANTHROPIC_API_KEY
// (packages/config) into a real AIProvider instance — pipeline stages ask
// this for a provider rather than importing a concrete provider class
// directly, so which provider handles text stays configuration, per
// docs/ai-pipeline.md "AIProvider abstraction". Falls back to NullProvider
// (no network calls, costs nothing) whenever no real key is configured —
// same "safe by default" posture as every other AI_* flag in this project
// (see packages/config's AI_KILL_SWITCH history) rather than throwing and
// blocking local dev/tests that never configured a key.
export function createTextProvider(): AIProvider {
  if (env.AI_DEFAULT_TEXT_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) {
    return new AnthropicProvider(env.ANTHROPIC_API_KEY);
  }
  return new NullProvider();
}
