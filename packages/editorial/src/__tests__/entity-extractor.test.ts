import { describe, expect, it } from "vitest";
import { extractCarModelMentions, type CarModelCandidate } from "../entity-extractor.js";

const bmw3Series: CarModelCandidate = {
  id: "cm_3series",
  matchTerms: ["3 Series", "330i", "M340i", "M3 Competition"],
};

describe("extractCarModelMentions", () => {
  it("matches a title containing the model's exact name", () => {
    expect(extractCarModelMentions("The BMW 3 Series Gets A New Look For 2027", [bmw3Series])).toEqual(["cm_3series"]);
  });

  it("matches a title containing a real trim name, case-insensitively", () => {
    expect(extractCarModelMentions("the all-new bmw 330i impresses in testing", [bmw3Series])).toEqual(["cm_3series"]);
  });

  it("does NOT match a real ambiguous headline listing multiple series numbers", () => {
    // Real headline from this project's ingested data — deliberately not a
    // match: "3, 5 And 7 Series" doesn't contain "3 Series" as a literal
    // substring, and guessing which series a comma-separated list actually
    // means would risk a wrong Knowledge Graph edge. This exact Story was
    // linked manually instead (packages/database/src/seed.ts).
    expect(
      extractCarModelMentions("BMW Recalls 189,130 3, 5 And 7 Series Over Starter Relay Fire Risk", [bmw3Series]),
    ).toEqual([]);
  });

  it("does NOT match on the brand name alone", () => {
    // A real ingested headline about a different BMW model entirely (M2,
    // not 3 Series) — matching on "BMW" alone would wrongly link this to
    // the 3 Series Knowledge Graph node.
    expect(extractCarModelMentions("Americans Give A Shift: Half Of BMW M2s Are Manuals", [bmw3Series])).toEqual([]);
  });

  it("returns an empty array for a title matching no candidate", () => {
    expect(extractCarModelMentions("Tesla Got Its Model Y L Range Wrong", [bmw3Series])).toEqual([]);
  });

  it("can match multiple candidates in the same title", () => {
    const modelY: CarModelCandidate = { id: "cm_modely", matchTerms: ["Model Y"] };
    expect(
      extractCarModelMentions("Comparison: BMW 3 Series vs Tesla Model Y", [bmw3Series, modelY]).sort(),
    ).toEqual(["cm_3series", "cm_modely"].sort());
  });
});
