import { describe, expect, it } from "vitest";
import { computeRankingScore } from "../ranking.js";

const NOW = new Date("2026-09-07T12:00:00Z");

describe("computeRankingScore", () => {
  it("scores a just-published, important, well-sourced story highly", () => {
    const score = computeRankingScore({
      importanceScore: 90,
      sourceQualityScore: 90,
      publishedAt: NOW,
      now: NOW,
    });
    expect(score).toBeCloseTo(82.5, 5);
  });

  it("decays freshness by exactly one half-life at 12h old", () => {
    const publishedAt = new Date(NOW.getTime() - 12 * 60 * 60 * 1000);
    const score = computeRankingScore({
      importanceScore: 90,
      sourceQualityScore: 90,
      publishedAt,
      now: NOW,
    });
    expect(score).toBeCloseTo(70.0, 5);
  });

  it("scores lower at 24h old (two half-lives) than at 0h old, all else equal", () => {
    const fresh = computeRankingScore({ importanceScore: 90, sourceQualityScore: 90, publishedAt: NOW, now: NOW });
    const stale = computeRankingScore({
      importanceScore: 90,
      sourceQualityScore: 90,
      publishedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
      now: NOW,
    });
    expect(stale).toBeLessThan(fresh);
    expect(stale).toBeCloseTo(63.75, 5);
  });

  it("weighs explicit engagement/editorialValue correctly", () => {
    const score = computeRankingScore({
      importanceScore: 0,
      sourceQualityScore: 0,
      publishedAt: NOW,
      now: NOW,
      engagementScore: 100,
      editorialValueScore: 100,
    });
    expect(score).toBeCloseTo(50, 5);
  });

  it("omitting engagement/editorialValue is equivalent to passing 50 (neutral default)", () => {
    const omitted = computeRankingScore({ importanceScore: 60, sourceQualityScore: 60, publishedAt: NOW, now: NOW });
    const explicit = computeRankingScore({
      importanceScore: 60,
      sourceQualityScore: 60,
      publishedAt: NOW,
      now: NOW,
      engagementScore: 50,
      editorialValueScore: 50,
    });
    expect(omitted).toBeCloseTo(explicit, 10);
  });

  it("never returns a negative score for the lowest possible inputs", () => {
    const score = computeRankingScore({
      importanceScore: 0,
      sourceQualityScore: 0,
      publishedAt: new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 365),
      now: NOW,
      engagementScore: 0,
      editorialValueScore: 0,
    });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
