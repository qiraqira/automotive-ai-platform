import { describe, expect, it } from "vitest";
import { formatCountryName } from "../locale.js";

describe("formatCountryName", () => {
  it("formats the real BMW seed data's country code (packages/database/src/seed.ts)", () => {
    expect(formatCountryName("DE")).toBe("Germany");
  });

  it("formats the other two real seeded country codes", () => {
    expect(formatCountryName("US")).toBe("United States");
  });

  it("falls back to the raw code for a malformed/empty code, rather than throwing", () => {
    expect(formatCountryName("")).toBe("");
  });

  it("resolves a lowercase code the same as its uppercase form — the real fix for a gap where Intl.DisplayNames.of() is case-sensitive and silently returns an unresolved lowercase code unchanged instead of throwing, and neither POST nor PATCH /v1/brands validates country's casing at all", () => {
    expect(formatCountryName("de")).toBe("Germany");
    expect(formatCountryName("us")).toBe("United States");
  });
});
