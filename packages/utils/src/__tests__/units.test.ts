import { describe, expect, it } from "vitest";
import { formatDistanceKm, formatPowerKw, kmToMiles, kwToHp, milesToKm, hpToKw } from "../units.js";

describe("formatDistanceKm", () => {
  it("matches docs/editorial-system.md's exact worked example: 500 km", () => {
    expect(formatDistanceKm(500, "imperial")).toBe("311 miles");
    expect(formatDistanceKm(500, "metric")).toBe("500 km");
  });
});

describe("formatPowerKw", () => {
  it("converts the real BMW M3 Competition seed figures (packages/database/src/seed.ts) both ways", () => {
    // Seed data: 503 hp → 375 kW (Math.round(503 * 0.7457)).
    expect(formatPowerKw(375, "imperial")).toBe("503 hp");
    expect(formatPowerKw(375, "metric")).toBe("375 kW");
  });
});

describe("round-trip conversions", () => {
  it("km → miles → km recovers the original value within floating-point tolerance", () => {
    expect(milesToKm(kmToMiles(500))).toBeCloseTo(500, 10);
  });

  it("kW → hp → kW recovers the original value within floating-point tolerance", () => {
    expect(hpToKw(kwToHp(375))).toBeCloseTo(375, 10);
  });
});
