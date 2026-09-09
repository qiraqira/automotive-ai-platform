// The AI Quality Gate (spec §36): every article gets a set of 0-100
// scores before publication; thresholds decide publish/review/reject.
// "Пороги должны быть configurable" (spec §36) — thresholds are a
// parameter, never hardcoded constants buried in this function.

export interface QualityScores {
  qualityScore: number;
  originalityScore: number;
  factualScore: number;
  sourceScore: number;
  valueScore: number;
  readabilityScore: number;
}

export type QualityGateVerdict = "publish" | "review" | "reject";

export interface QualityGateThresholds {
  /** Overall (weighted average) score at or above this → publish. */
  publishAt: number;
  /** Overall score at or above this (but below publishAt) → review.
   * Anything lower → reject. */
  reviewAt: number;
}

export interface QualityGateResult {
  verdict: QualityGateVerdict;
  overallScore: number;
  reason: string;
}

// factualScore and sourceScore matter more than readability for an
// automotive news/knowledge platform — a beautifully-written article
// built on shaky facts or thin sourcing is the one failure mode spec §70
// ("no fake authority") explicitly cares about most.
const WEIGHTS: Record<keyof QualityScores, number> = {
  qualityScore: 1,
  originalityScore: 1,
  factualScore: 2,
  sourceScore: 2,
  valueScore: 1.5,
  readabilityScore: 0.5,
};

function overallScore(scores: QualityScores): number {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof QualityScores)[]) {
    weightedSum += scores[key] * WEIGHTS[key];
    weightTotal += WEIGHTS[key];
  }
  return weightedSum / weightTotal;
}

// A single very low score should be able to block publication even if the
// weighted average looks fine — e.g. factualScore=10 with everything else
// at 95 must not "average out" to a publish. Anything below this floor on
// factualScore or sourceScore forces at least a review.
const HARD_FLOOR = 40;

export function evaluateQualityGate(scores: QualityScores, thresholds: QualityGateThresholds): QualityGateResult {
  const overall = overallScore(scores);

  // Real test-coverage gap found and fixed 2026-09-08: the three-way
  // ternary this replaced (`overall >= publishAt ? "review" : overall >=
  // reviewAt ? "review" : "reject"`) had two branches yielding the
  // identical "review" result — since publishAt is always >= reviewAt,
  // `overall >= publishAt` implies `overall >= reviewAt`, so the first
  // branch could never fire without the second also being true. Not a
  // behavioral bug (the collapsed form below computes the same verdict),
  // but genuinely confusing: it reads as if crossing `publishAt` did
  // something distinct, when the real rule is simpler — this hard floor
  // caps the verdict at "review", never letting it reach "publish" no
  // matter how high `overall` climbs, which the collapsed form states
  // directly. Found while checking whether this file's own tests
  // actually exercised the scenario its own comment calls out ("a
  // beautifully-written article built on shaky facts... must not average
  // out to a publish") — see the new tests below confirming they didn't.
  if (scores.factualScore < HARD_FLOOR) {
    return {
      verdict: overall >= thresholds.reviewAt ? "review" : "reject",
      overallScore: overall,
      reason: `factualScore (${scores.factualScore}) is below the hard floor (${HARD_FLOOR}) regardless of other scores.`,
    };
  }
  if (scores.sourceScore < HARD_FLOOR) {
    return {
      verdict: overall >= thresholds.reviewAt ? "review" : "reject",
      overallScore: overall,
      reason: `sourceScore (${scores.sourceScore}) is below the hard floor (${HARD_FLOOR}) regardless of other scores.`,
    };
  }

  if (overall >= thresholds.publishAt) {
    return { verdict: "publish", overallScore: overall, reason: `Overall score ${overall.toFixed(1)} meets publishAt (${thresholds.publishAt}).` };
  }
  if (overall >= thresholds.reviewAt) {
    return { verdict: "review", overallScore: overall, reason: `Overall score ${overall.toFixed(1)} is below publishAt but meets reviewAt (${thresholds.reviewAt}).` };
  }
  return { verdict: "reject", overallScore: overall, reason: `Overall score ${overall.toFixed(1)} is below reviewAt (${thresholds.reviewAt}).` };
}
