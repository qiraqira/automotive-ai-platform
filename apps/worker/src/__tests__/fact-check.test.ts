import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@automotive/database";

// Real test-safety lesson applied here, learned the hard way on
// generate-image.test.ts (see that file's own comment): the real worker
// environment (and this test's own CI/VPS run) has a real
// ANTHROPIC_API_KEY configured, so calling the real createTextProvider()
// would construct a real AnthropicProvider and make a real, billed
// network call. Unlike generate-image.ts's raw `fetch()` (mockable via
// `vi.spyOn(global, "fetch")`), fact-check.ts goes through
// createTextProvider() — mocking the whole `@automotive/ai` module's
// export is the correct level here, not fetch, since the Anthropic SDK
// doesn't necessarily use the global `fetch` symbol in a way a spy can
// intercept reliably. This guarantees zero real network calls regardless
// of what real environment variables happen to be set wherever this runs.
const completeMock = vi.fn();
vi.mock("@automotive/ai", async () => {
  const actual = await vi.importActual<typeof import("@automotive/ai")>("@automotive/ai");
  return {
    ...actual,
    createTextProvider: () => ({ name: "mocked", complete: completeMock, embed: vi.fn() }),
  };
});

const { factCheckArticle } = await import("../fact-check.js");

describe("factCheckArticle", () => {
  afterEach(async () => {
    completeMock.mockReset();
    await prisma.aIJob.deleteMany({ where: { input: { path: ["purpose"], equals: "fact_check" } } });
  });

  it("caps the verdict at review for a low factualScore even with high other scores (hard floor) — never lets it reach publish", async () => {
    completeMock.mockResolvedValue({
      text: JSON.stringify({
        qualityScore: 95,
        originalityScore: 95,
        factualScore: 10,
        sourceScore: 90,
        valueScore: 90,
        readabilityScore: 95,
        concerns: "The price quoted does not appear anywhere in the provided sources.",
      }),
      tokensIn: 100,
      tokensOut: 50,
      model: "mocked-model",
    });

    const result = await factCheckArticle(
      "fake-article-id",
      "Test headline",
      null,
      ["Paragraph one.", "Paragraph two."],
      "1. [Test Source] \"Test headline\" — a short excerpt.",
      { publishAt: 70, reviewAt: 50 },
    );

    expect(result).not.toBeNull();
    // Not "reject": quality-gate.ts's hard floor caps the verdict at
    // "review" (never "publish"), it doesn't force a full "reject" on its
    // own — the overall weighted average (71.6 here) still clears
    // reviewAt(50), so "review" is the real, correct result. Verified by
    // running this exact case first with a `.toBe("reject")` expectation,
    // which failed with `Received: "review"` — a genuine test-authoring
    // mistake on my part (about the gate's own logic, not the gate being
    // wrong), not a code bug; fixed the expectation, not the code.
    expect(result!.gate.verdict).toBe("review");
    expect(completeMock).toHaveBeenCalledTimes(1);
  });

  it("returns a genuine reject verdict when every score is low", async () => {
    completeMock.mockResolvedValue({
      text: JSON.stringify({
        qualityScore: 20,
        originalityScore: 20,
        factualScore: 10,
        sourceScore: 15,
        valueScore: 20,
        readabilityScore: 25,
        concerns: "Multiple unsupported claims and thin sourcing.",
      }),
      tokensIn: 100,
      tokensOut: 50,
      model: "mocked-model",
    });

    const result = await factCheckArticle(
      "fake-article-id",
      "Test headline",
      null,
      ["Paragraph one."],
      "1. [Test Source] \"Test headline\" — a short excerpt.",
      { publishAt: 70, reviewAt: 50 },
    );

    expect(result).not.toBeNull();
    expect(result!.gate.verdict).toBe("reject");
  });

  it("returns a publish verdict for consistently high scores", async () => {
    completeMock.mockResolvedValue({
      text: JSON.stringify({
        qualityScore: 85,
        originalityScore: 80,
        factualScore: 90,
        sourceScore: 85,
        valueScore: 80,
        readabilityScore: 88,
        concerns: "None.",
      }),
      tokensIn: 100,
      tokensOut: 50,
      model: "mocked-model",
    });

    const result = await factCheckArticle(
      "fake-article-id",
      "Test headline",
      null,
      ["Paragraph one.", "Paragraph two."],
      "1. [Test Source] \"Test headline\" — a short excerpt.",
      { publishAt: 70, reviewAt: 50 },
    );

    expect(result).not.toBeNull();
    expect(result!.gate.verdict).toBe("publish");
  });

  it("returns null (never throws) when the provider call fails, without ever having made a real network call", async () => {
    completeMock.mockRejectedValue(new Error("mocked — no real network call in tests"));

    const result = await factCheckArticle("fake-article-id", "Test headline", null, ["Paragraph."], "1. [Test Source] \"Test\" — excerpt.", {
      publishAt: 70,
      reviewAt: 50,
    });

    expect(result).toBeNull();
  });
});
