import { describe, expect, it } from "vitest";
import { evaluateQualityGate, type QualityScores } from "../quality-gate.js";

const HIGH: QualityScores = {
  qualityScore: 90,
  originalityScore: 85,
  factualScore: 95,
  sourceScore: 90,
  valueScore: 88,
  readabilityScore: 92,
};

const THRESHOLDS = { publishAt: 75, reviewAt: 50 };

describe("evaluateQualityGate", () => {
  it("publishes a genuinely high-quality article", () => {
    const result = evaluateQualityGate(HIGH, THRESHOLDS);
    expect(result.verdict).toBe("publish");
  });

  it("sends a mediocre article to review", () => {
    const scores: QualityScores = { ...HIGH, qualityScore: 55, originalityScore: 50, valueScore: 55, readabilityScore: 60 };
    const result = evaluateQualityGate(scores, THRESHOLDS);
    expect(result.verdict).toBe("review");
  });

  it("rejects a genuinely poor article", () => {
    const scores: QualityScores = {
      qualityScore: 20,
      originalityScore: 15,
      factualScore: 45,
      sourceScore: 45,
      valueScore: 10,
      readabilityScore: 30,
    };
    const result = evaluateQualityGate(scores, THRESHOLDS);
    expect(result.verdict).toBe("reject");
  });

  it("never publishes on a low factualScore even if every other score is excellent", () => {
    const scores: QualityScores = { ...HIGH, factualScore: 20 };
    const result = evaluateQualityGate(scores, THRESHOLDS);
    expect(result.verdict).not.toBe("publish");
  });

  it("never publishes on a low sourceScore even if every other score is excellent", () => {
    const scores: QualityScores = { ...HIGH, sourceScore: 20 };
    const result = evaluateQualityGate(scores, THRESHOLDS);
    expect(result.verdict).not.toBe("publish");
  });

  // Real test-coverage gap found and fixed 2026-09-08: the two tests
  // above use HIGH's own scores, whose weighted average (with
  // factualScore/sourceScore dropped to 20) already falls below
  // `publishAt` from ordinary averaging alone — so they'd pass identically
  // even if the hard-floor logic were deleted outright, never actually
  // proving this file's own stated purpose ("a beautifully-written
  // article built on shaky facts... must not average out to a publish").
  // These two construct the case that actually exercises it: every other
  // score at 100, only factualScore/sourceScore low — a weighted average
  // that would clear `publishAt` on its own (100·1+100·1+20·2+100·2+100·1.5+100·0.5)/8
  // = 90 ≥ 75 — confirming the hard floor genuinely downgrades what
  // would otherwise be a real "publish" to "review", not just happening
  // to agree with an already-low average.
  it("downgrades to review, not reject, when factualScore is below the hard floor but every other score is perfect (the average alone would say 'publish')", () => {
    const scores: QualityScores = { qualityScore: 100, originalityScore: 100, factualScore: 20, sourceScore: 100, valueScore: 100, readabilityScore: 100 };
    const result = evaluateQualityGate(scores, THRESHOLDS);
    expect(result.verdict).toBe("review");
  });

  it("downgrades to review, not reject, when sourceScore is below the hard floor but every other score is perfect (the average alone would say 'publish')", () => {
    const scores: QualityScores = { qualityScore: 100, originalityScore: 100, factualScore: 100, sourceScore: 20, valueScore: 100, readabilityScore: 100 };
    const result = evaluateQualityGate(scores, THRESHOLDS);
    expect(result.verdict).toBe("review");
  });

  it("still rejects a low factualScore when the overall average is also genuinely poor, not just capped at review", () => {
    const scores: QualityScores = { qualityScore: 10, originalityScore: 10, factualScore: 5, sourceScore: 10, valueScore: 10, readabilityScore: 10 };
    const result = evaluateQualityGate(scores, THRESHOLDS);
    expect(result.verdict).toBe("reject");
  });

  it("respects custom (stricter) thresholds", () => {
    const strict = { publishAt: 95, reviewAt: 80 };
    const result = evaluateQualityGate(HIGH, strict);
    // HIGH's weighted average is below 95, so it can't publish under a
    // stricter gate even though it publishes under the default one.
    expect(result.verdict).not.toBe("publish");
  });
});
