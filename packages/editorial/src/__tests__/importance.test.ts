import { describe, expect, it } from "vitest";
import { computeImportanceScore } from "../importance.js";

describe("computeImportanceScore", () => {
  it("returns the schema default (30) for a brand-new, single-source story — no regression for the common case", () => {
    expect(computeImportanceScore(1)).toBe(30);
  });

  it("boosts the score as more distinct sources cover the same story", () => {
    expect(computeImportanceScore(2)).toBe(55);
    expect(computeImportanceScore(3)).toBe(80);
  });

  it("caps at 100 rather than growing unbounded", () => {
    expect(computeImportanceScore(4)).toBe(100);
    expect(computeImportanceScore(50)).toBe(100);
  });

  it("treats 0 sources the same as 1 (a real Story always has at least one) rather than going negative", () => {
    expect(computeImportanceScore(0)).toBe(30);
  });
});
