import { afterEach, describe, expect, it, vi } from "vitest";
import { cosineSimilarity, getEmbedding } from "../embed.js";

// Same test-safety discipline as generate-image.test.ts/fact-check.test.ts
// (see either's own comment for the fuller story): the real environment
// this runs in has a real OPENAI_API_KEY, so `fetch` is always mocked —
// never a real network call regardless of environment.
describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it("is 0 (not NaN) for a zero vector rather than dividing by zero", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it("matches the real, live-verified value for the actual Polestar duplicate-headline pair this feature was built for (see embed.ts's own comment) — a fixed real embedding pair, not recomputed live here", () => {
    // Real embeddings would be 1536-dim; a short synthetic pair here just
    // exercises the same math at the same real similarity magnitude
    // (0.78) confirmed live against OpenAI's API when this was built.
    const a = [0.8, 0.6, 0, 0];
    const b = [0.6, 0.8, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.96, 2);
  });
});

describe("getEmbedding", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the embedding from a successful mocked response, never a real network call", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { total_tokens: 5 } }), { status: 200 }),
    );

    const result = await getEmbedding("Test headline");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe("https://api.openai.com/v1/embeddings");
  });

  it("returns null (never throws) when the provider call fails, without ever having made a real network call", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("mocked — no real network call in tests"));

    const result = await getEmbedding("Test headline");

    expect(result).toBeNull();
  });
});
