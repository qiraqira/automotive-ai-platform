import { afterEach, describe, expect, it, vi } from "vitest";
import { generateHeroImage } from "../generate-image.js";

// Real, severe editorial-ethics gap found live 2026-09-09 (the user
// directly reviewed a real generated image and flagged it): see
// generate-image.ts's own comment for the full story — a photorealistic
// AI-generated crash-scene image was attached to a real fatality story.
// This is the one real branch of that file testable without a real
// OpenAI network call (checked before the key check on purpose — see
// that file's comment).
//
// Real, live-caught test-hygiene incident while first writing this test
// (2026-09-09, same day): an earlier version of this file called
// generateHeroImage() for a non-sensitive topic with no mocked `fetch` —
// against the real production worker (a real OPENAI_API_KEY is
// configured there), this made a REAL, paid OpenAI call that outlived
// vitest's own 5s per-test timeout (the underlying fetch keeps running
// in the background after vitest gives up waiting on it), confirmed live
// via the real AIExecution/Image rows this left behind. Every test here
// now mocks `global.fetch` and asserts on whether it was called, never
// letting a real network request happen regardless of what real
// environment variables happen to be set wherever this runs.
describe("generateHeroImage — sensitive-topic gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses to generate for a safety-recalls-topic article without ever calling fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const result = await generateHeroImage("fake-article-id", "Second Tesla driver killed after Autopilot crash", null, "safety-recalls");
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not block on an unrelated topic — reaches the real fetch call (mocked here, never real)", async () => {
    // A controlled, immediate rejection — proves this test reaches the
    // real network-call code path (unlike the sensitive-topic case
    // above) without ever letting a real request leave this process.
    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("mocked — no real network call in tests"));
    const result = await generateHeroImage("fake-article-id", "Kia reveals new EV concept", null, "electric-vehicles");
    expect(result).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not block when no topic is classified at all (null) — also reaches the mocked fetch", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("mocked — no real network call in tests"));
    const result = await generateHeroImage("fake-article-id", "Some unclassified headline", null, null);
    expect(result).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
