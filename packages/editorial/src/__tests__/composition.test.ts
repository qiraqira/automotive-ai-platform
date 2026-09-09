import { describe, expect, it } from "vitest";
import { decideComposition } from "../composition.js";

describe("decideComposition", () => {
  it("CREATEs when no live article covers this purpose yet", () => {
    const result = decideComposition({
      desiredPurpose: "BACKGROUND",
      existingArticles: [],
      knowledgeDelta: 5,
    });
    expect(result.decision).toBe("CREATE");
  });

  it("UPDATEs the existing article when the same purpose exists and there is new information", () => {
    const result = decideComposition({
      desiredPurpose: "BACKGROUND",
      existingArticles: [{ id: "art-1", contentPurpose: "BACKGROUND", status: "PUBLISHED" }],
      knowledgeDelta: 17,
    });
    expect(result).toMatchObject({ decision: "UPDATE", targetArticleId: "art-1" });
  });

  it("REJECTs when the same purpose exists but there is no new information", () => {
    const result = decideComposition({
      desiredPurpose: "BACKGROUND",
      existingArticles: [{ id: "art-1", contentPurpose: "BACKGROUND", status: "PUBLISHED" }],
      knowledgeDelta: 0,
    });
    expect(result).toMatchObject({ decision: "REJECT", targetArticleId: "art-1" });
  });

  it("ignores ARCHIVED/REJECTED articles when checking for an existing purpose match", () => {
    const result = decideComposition({
      desiredPurpose: "BACKGROUND",
      existingArticles: [{ id: "art-1", contentPurpose: "BACKGROUND", status: "ARCHIVED" }],
      knowledgeDelta: 0,
    });
    expect(result.decision).toBe("CREATE");
  });

  it("a different contentPurpose on the same story does not block CREATE (spec: NEWS + COMPARISON can coexist)", () => {
    const result = decideComposition({
      desiredPurpose: "COMPARISON",
      existingArticles: [{ id: "art-1", contentPurpose: "BACKGROUND", status: "PUBLISHED" }],
      knowledgeDelta: 5,
    });
    expect(result.decision).toBe("CREATE");
  });

  it("MERGEs when two live articles already share the same purpose (drift the engine should have prevented)", () => {
    const result = decideComposition({
      desiredPurpose: "BACKGROUND",
      existingArticles: [
        { id: "art-1", contentPurpose: "BACKGROUND", status: "PUBLISHED" },
        { id: "art-2", contentPurpose: "BACKGROUND", status: "UPDATED" },
      ],
      knowledgeDelta: 5,
    });
    expect(result.decision).toBe("MERGE");
  });
});
