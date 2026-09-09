import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "../providers/anthropic-provider.js";

// Unit tests against a fake Anthropic client (constructor-injected, same
// pattern this codebase already uses for testability elsewhere) — no real
// network calls, no real spend, matching the discipline every other
// dormant-but-unit-tested piece of packages/ai already follows (see
// budget.test.ts's own comment on why *that* one talks to a real DB
// instead: the two cases differ, a real Anthropic call costs real money
// and needs a real key, a real local Postgres does neither).

function fakeClient(create: (params: unknown) => Promise<unknown>) {
  return { messages: { create } } as unknown as Anthropic;
}

describe("AnthropicProvider", () => {
  it("returns text/token counts/model from a successful completion", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      model: "claude-haiku-4-5",
      usage: { input_tokens: 12, output_tokens: 34 },
      content: [{ type: "text", text: "hello world" }],
    });
    const provider = new AnthropicProvider("fake-key", DEFAULT_ANTHROPIC_MODEL, fakeClient(create));

    const result = await provider.complete({ prompt: "say hi" });

    expect(result).toEqual({ text: "hello world", tokensIn: 12, tokensOut: 34, model: "claude-haiku-4-5" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: DEFAULT_ANTHROPIC_MODEL, messages: [{ role: "user", content: "say hi" }] }),
    );
  });

  it("passes responseSchema through as output_config.format (verified against the installed SDK's JSONOutputFormat type)", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      model: "claude-haiku-4-5",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: "{}" }],
    });
    const provider = new AnthropicProvider("fake-key", DEFAULT_ANTHROPIC_MODEL, fakeClient(create));
    const schema = { type: "object", properties: { topic: { type: "string" } } };

    await provider.complete({ prompt: "classify", responseSchema: schema });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ output_config: { format: { type: "json_schema", schema } } }),
    );
  });

  it("throws on a refusal instead of returning empty/misleading text", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: null },
      model: "claude-haiku-4-5",
      usage: { input_tokens: 1, output_tokens: 0 },
      content: [],
    });
    const provider = new AnthropicProvider("fake-key", DEFAULT_ANTHROPIC_MODEL, fakeClient(create));

    await expect(provider.complete({ prompt: "..." })).rejects.toThrow(/refused/i);
  });

  it("throws when the response has no text block", async () => {
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      model: "claude-haiku-4-5",
      usage: { input_tokens: 1, output_tokens: 0 },
      content: [],
    });
    const provider = new AnthropicProvider("fake-key", DEFAULT_ANTHROPIC_MODEL, fakeClient(create));

    await expect(provider.complete({ prompt: "..." })).rejects.toThrow(/no text block/i);
  });

  it("embed() throws — Anthropic has no embeddings API", async () => {
    const provider = new AnthropicProvider("fake-key");
    await expect(provider.embed({ input: "x" })).rejects.toThrow(/no embeddings API/i);
  });
});
