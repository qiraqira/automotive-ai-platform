import { describe, expect, it } from "vitest";
import { countIndependentOrigins, groupByInformationOrigin } from "../source-independence.js";

describe("groupByInformationOrigin", () => {
  it("groups articles citing the same primary release into one origin", () => {
    const groups = groupByInformationOrigin([
      { id: "a1", originUrl: "https://bmw.com/press/x" },
      { id: "a2", originUrl: "https://bmw.com/press/x" },
      { id: "a3", originUrl: "https://bmw.com/press/x" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.articleIds).toEqual(["a1", "a2", "a3"]);
  });

  it("treats each article with no detected origin as its own independent origin", () => {
    const groups = groupByInformationOrigin([{ id: "a1" }, { id: "a2" }]);
    expect(groups).toHaveLength(2);
  });

  it("handles a mix: some citing a shared release, one genuinely independent", () => {
    const groups = groupByInformationOrigin([
      { id: "a1", originUrl: "https://bmw.com/press/x" },
      { id: "a2", originUrl: "https://bmw.com/press/x" },
      { id: "a3" },
    ]);
    expect(groups).toHaveLength(2);
  });

  // Real test-coverage gap found and fixed 2026-09-08: SourceArticleForIndependence's
  // own type declares `originUrl?: string | null` — explicitly anticipating
  // a real, literal `null` (not just an omitted field), matching how
  // Prisma actually represents an empty nullable column (always `null`,
  // never `undefined`) once a real `originUrl` field exists on
  // `SourceArticle` (it doesn't yet — see this package's own README row).
  // Every existing test only ever OMITS the field; nothing proved a
  // literal `null` is treated identically, which only holds here because
  // `??` (not `||` or a manual `!== undefined` check) treats both as
  // equally "nothing detected" — an easy thing for a future edit to get
  // wrong in a way no existing test would catch.
  it("treats an explicit null originUrl the same as an omitted one, not as a distinct falsy value", () => {
    const groups = groupByInformationOrigin([
      { id: "a1", originUrl: null },
      { id: "a2" },
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("countIndependentOrigins", () => {
  it("10 articles citing the same release count as 1 independent origin, not 10", () => {
    const articles = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      originUrl: "https://bmw.com/press/x",
    }));
    expect(countIndependentOrigins(articles)).toBe(1);
  });

  it("is 0 for no articles", () => {
    expect(countIndependentOrigins([])).toBe(0);
  });
});
