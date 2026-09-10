import { describe, it, expect } from "vitest";
import { buildSearchQueries } from "../fetch-images.js";

describe("buildSearchQueries", () => {
  // Real gap found live 2026-09-10: a headline built around a possessive
  // ("Corvette E-Ray's Legacy Shapes...") found zero usable images from
  // either free-stock provider — no real photo file is ever titled with
  // a prose possessive ("E-Ray's"), so every candidate failed the
  // relevance check before it even got a chance. Locks in the fix:
  // every generated query has the possessive stripped.
  it("strips a possessive 's so queries match how real photo files are actually titled", () => {
    const queries = buildSearchQueries(["Corvette E-Ray's Legacy Shapes Future Electrified Performance Cars"]);
    expect(queries).toContain("Corvette E-Ray");
    expect(queries.some((q) => q.includes("E-Ray's"))).toBe(false);
  });

  it("strips a bare trailing apostrophe (plural possessive)", () => {
    const queries = buildSearchQueries(["Automakers' Response to New Tariffs"]);
    expect(queries.some((q) => q.includes("Automakers'"))).toBe(false);
  });

  it("leaves a genuine hyphenated model name intact", () => {
    const queries = buildSearchQueries(["Tesla Model S Plaid Review"]);
    expect(queries).toContain("Tesla Model S Plaid Review");
  });

  it("still builds the full-text, first-4-word, and first-2-word variants", () => {
    const queries = buildSearchQueries(["BMW Enlists iX3 Drivers in Safety Data Collection Program"]);
    expect(queries).toEqual([
      "BMW Enlists iX3 Drivers in Safety Data Collection Program",
      "BMW Enlists iX3 Drivers",
      "BMW Enlists",
    ]);
  });
});
