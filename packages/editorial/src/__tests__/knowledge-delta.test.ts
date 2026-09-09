import { describe, expect, it } from "vitest";
import { computeFactDeltas, summarizeKnowledgeDelta } from "../knowledge-delta.js";

describe("computeFactDeltas", () => {
  it("flags a brand-new attribute as changed with no numericDelta", () => {
    const deltas = computeFactDeltas([], [{ attribute: "range_miles", value: "320" }]);
    expect(deltas[0]).toMatchObject({ changed: true, numericDelta: null, previousValue: null, newValue: "320" });
  });

  it("computes a numeric delta for the exact Model Y example from docs/editorial-system.md", () => {
    const deltas = computeFactDeltas(
      [{ attribute: "range_miles", value: "320", unit: "miles" }],
      [{ attribute: "range_miles", value: "337", unit: "miles" }],
    );
    expect(deltas[0]).toMatchObject({ changed: true, numericDelta: 17, previousValue: "320", newValue: "337" });
  });

  it("reports no change when the value is identical", () => {
    const deltas = computeFactDeltas(
      [{ attribute: "power_hp", value: "503" }],
      [{ attribute: "power_hp", value: "503" }],
    );
    expect(deltas[0]).toMatchObject({ changed: false, numericDelta: 0 });
  });

  it("handles a non-numeric change (e.g. a status flip) without crashing, numericDelta null", () => {
    const deltas = computeFactDeltas(
      [{ attribute: "availability", value: "coming_soon" }],
      [{ attribute: "availability", value: "on_sale" }],
    );
    expect(deltas[0]).toMatchObject({ changed: true, numericDelta: null, previousValue: "coming_soon", newValue: "on_sale" });
  });

  it("a negative change (price cut) computes a negative delta, not an absolute value", () => {
    const deltas = computeFactDeltas(
      [{ attribute: "price_usd", value: "45000" }],
      [{ attribute: "price_usd", value: "42000" }],
    );
    expect(deltas[0]!.numericDelta).toBe(-3000);
  });

  // Real test-coverage gap found and fixed 2026-09-08: a real, plausible
  // case for this project (a later crawl re-reporting the same
  // underlying fact with different string formatting, e.g. trailing
  // precision) — the string values differ ("155" !== "155.0"), so this
  // is correctly `changed: true` per the string-equality check above,
  // but the two values parse to the identical number, so `numericDelta`
  // is genuinely `0`, not `null`. Nothing exercised this distinct-from-
  // both-neighbors case before: unlike "reports no change when the value
  // is identical" (string-equal, short-circuits before reaching numeric
  // parsing at all) and the non-numeric-change test (numericDelta null),
  // this is the one real path where numericDelta is a non-null zero.
  it("flags a changed fact whose numeric value is unchanged but the string representation differs (e.g. trailing precision)", () => {
    const deltas = computeFactDeltas(
      [{ attribute: "range_miles", value: "155" }],
      [{ attribute: "range_miles", value: "155.0" }],
    );
    expect(deltas[0]).toMatchObject({ changed: true, numericDelta: 0, previousValue: "155", newValue: "155.0" });
  });
});

describe("summarizeKnowledgeDelta", () => {
  it("is 0 when nothing changed", () => {
    const deltas = computeFactDeltas([{ attribute: "a", value: "1" }], [{ attribute: "a", value: "1" }]);
    expect(summarizeKnowledgeDelta(deltas)).toBe(0);
  });

  it("sums numeric deltas by absolute magnitude", () => {
    const deltas = computeFactDeltas(
      [{ attribute: "range_miles", value: "320" }, { attribute: "price_usd", value: "45000" }],
      [{ attribute: "range_miles", value: "337" }, { attribute: "price_usd", value: "42000" }],
    );
    expect(summarizeKnowledgeDelta(deltas)).toBe(17 + 3000);
  });

  it("counts a non-numeric change as at least 1, not 0", () => {
    const deltas = computeFactDeltas([{ attribute: "status", value: "rumor" }], [{ attribute: "status", value: "confirmed" }]);
    expect(summarizeKnowledgeDelta(deltas)).toBeGreaterThan(0);
  });

  // Real test-coverage gap found and fixed 2026-09-08: this function's
  // own comment ("every changed fact contributes at least 1... so a
  // purely non-numeric change still counts as real delta, not zero just
  // because it has no magnitude") only names the non-numeric case, but
  // the actual implementation's `Math.abs(d.numericDelta) || 1` fallback
  // also covers a distinct case: a changed fact whose numericDelta is a
  // real, non-null zero (see computeFactDeltas' own new test above for
  // when this happens). Without this test, a future edit that changed
  // `|| 1` to `?? 1` (which would NOT catch a falsy-but-defined 0) could
  // silently start summing this case to 0 — a real, previously-possible
  // regression this closes.
  it("counts a changed fact with a real zero numericDelta as at least 1, not 0 (the `|| 1` fallback, not just the `numericDelta === null` case)", () => {
    const deltas = computeFactDeltas([{ attribute: "range_miles", value: "155" }], [{ attribute: "range_miles", value: "155.0" }]);
    expect(deltas[0]!.numericDelta).toBe(0); // sanity: confirms this exercises the `|| 1` branch, not the `: 1` one
    expect(summarizeKnowledgeDelta(deltas)).toBe(1);
  });
});
