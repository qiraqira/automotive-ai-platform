import { describe, expect, it } from "vitest";
import { classifyTopic } from "../topic-classifier.js";

describe("classifyTopic", () => {
  it("classifies a real recall headline as safety-recalls", () => {
    expect(classifyTopic("BMW Recalls 189,130 3, 5 And 7 Series Over Starter Relay Fire Risk")).toBe("safety-recalls");
  });

  it("classifies a real EV headline as electric-vehicles", () => {
    expect(classifyTopic("Tesla Got Its Model Y L Range Wrong, EPA Gives It More Miles")).toBe("electric-vehicles");
  });

  it("classifies a real sales/market headline as market-business", () => {
    expect(classifyTopic("Sales Of Hybrids Are Soaring. That's Bad News For EVs")).toBe("market-business");
  });

  it("prefers safety-recalls over electric-vehicles when a headline matches both (order matters)", () => {
    expect(classifyTopic("EV recall issued over battery fire risk")).toBe("safety-recalls");
  });

  it("returns null when nothing matches, rather than forcing a wrong topic", () => {
    expect(classifyTopic("Why Do Some Cars Have Dual-Clutch Transmissions?")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(classifyTopic("TESLA UNVEILS NEW BATTERY TECH")).toBe("electric-vehicles");
  });

  // Real gap found and fixed 2026-09-08: checked every real ingested
  // Story title in the dev DB against this classifier and found several
  // genuinely safety/fatality headlines fell through to
  // "electric-vehicles" purely because they mention "tesla"/"electric"
  // and matched none of the safety keywords — these are the real
  // headlines that exposed the gap.
  it("classifies a real fatal-crash headline as safety-recalls, not electric-vehicles, despite mentioning Tesla/Autopilot", () => {
    expect(classifyTopic("A Tesla killed a motorcyclist on Autopilot/FSD, Tesla's own data confirms")).toBe(
      "safety-recalls",
    );
    expect(classifyTopic("A second Tesla driver died stopped on a freeway with Autopilot/Self-Driving on")).toBe(
      "safety-recalls",
    );
    expect(classifyTopic("Tesla settles fatal Autopilot fire truck lawsuit, avoiding jury trial")).toBe(
      "safety-recalls",
    );
  });

  it("does not over-match on a broader 'kill'/'death' — a real unrelated headline stays correctly classified", () => {
    // A real headline using "killing" in the product-discontinuation
    // sense, not a fatality — must NOT become safety-recalls.
    expect(classifyTopic("Tesla killing Solar Roof is leaving installers with six-figure losses")).toBe(
      "electric-vehicles",
    );
    // A real headline using "death spiral" as a business metaphor, not a
    // literal fatality — must not match any topic at all.
    expect(classifyTopic("Cratering oil use in China shows the death spiral that could end oil")).toBeNull();
  });

  // Real gap found and fixed 2026-09-08, same pass as the safety-recalls
  // fix above: real layoff/job-cut headlines were going entirely
  // unclassified — these are the real headlines that exposed the gap.
  it("classifies real layoff/job-cut headlines as market-business", () => {
    expect(classifyTopic("VW to cut 100k jobs and may stop building EVs at 4 plants")).toBe("market-business");
    expect(classifyTopic("Jaguar Land Rover Opens Voluntary Layoffs, Are 4,000 Jobs Really At Risk?")).toBe(
      "market-business",
    );
  });

  it("does not over-match on a broader 'cfo' — a real unrelated headline correctly lands in micromobility instead, not market-business", () => {
    // "cfo" is a real mid-word substring of "Macfox" (an e-bike brand) —
    // must not become market-business. Updated 2026-09-08 when the new
    // micromobility rule (below) was added — this headline's real
    // "e-bike" mention now correctly classifies it there instead of
    // staying null, which is the more accurate real answer, not a
    // regression of the original "not market-business" guarantee.
    expect(classifyTopic("Macfox X1S e-bike review: More mini-moto than bicycle, yet still street legal")).toBe(
      "micromobility",
    );
  });

  // Real gap found and fixed 2026-09-08: checked every real ingested
  // Story title (73 unclassified at the time) and found two real,
  // sizeable clusters with nowhere to land — these are real headlines
  // from that check.
  it("classifies real e-bike/e-scooter headlines as micromobility", () => {
    expect(classifyTopic("ENGWE's new E26 3.0 e-bike packs dual motors, full suspension, and half a deer")).toBe(
      "micromobility",
    );
    expect(classifyTopic("Navee Labor Day e-scooter sale")).toBe("micromobility");
  });

  it("classifies real robotaxi/autonomous headlines as autonomous-robotaxi", () => {
    expect(classifyTopic("Waymo opens robotaxi rides to the public in 3 new cities, now 14 total")).toBe(
      "autonomous-robotaxi",
    );
    expect(classifyTopic("Uber just launched the UK's first autonomous rides in London")).toBe(
      "autonomous-robotaxi",
    );
    expect(classifyTopic("Survey Sunday: will Cybercab transform mobility, or be just another car?")).toBe(
      "autonomous-robotaxi",
    );
  });
});
