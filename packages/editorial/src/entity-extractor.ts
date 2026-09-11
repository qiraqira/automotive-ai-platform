// Rule-based entity extraction — a stand-in for the AI Researcher/
// FactExtractor pipeline stage's entity-linking, same honesty convention
// as topic-classifier.ts and apps/worker's pg_trgm clustering. Deliberately
// conservative: matches only on precise designators (a CarModel's own name
// and its real trim names), never a Brand name alone — "BMW" appears in
// plenty of headlines about models this isn't, and a wrong Knowledge Graph
// edge is worse than a missed one. A headline like "BMW Recalls ... 3, 5
// And 7 Series ..." deliberately does NOT match (no exact "3 Series"
// substring) — precision over recall, consistent with this project's other
// conservative thresholds (e.g. ingest.ts's TITLE_SIMILARITY_THRESHOLD).
//
// Real gap found and fixed 2026-09-11, caught the first time this ever
// ran against a real model short enough to be an ordinary word fragment:
// after seeding the real Mercedes-Benz GLE (see seed-real-cars.ts),
// checking this function against the real ingested corpus for a manual
// verification pass found it would have matched "gle" as a plain
// substring inside "Engwe's $900 Eagle" and "Glencore reaches new
// milestone" — neither headline is about the GLE at all. "BMW"/"3
// Series" never hit this because they either weren't tried as a bare
// substring or were long/distinctive enough to avoid it by luck, not by
// this function actually enforcing a boundary. Fixed with the same
// word-boundary regex approach apps/worker/src/fetch-images.ts's
// isRelevantTitle()/detectBrand() already use for the identical class of
// problem (a short/common brand or model name embedded inside an
// unrelated longer word).

export interface CarModelCandidate {
  id: string;
  /** The model's own name plus its real trim names — never a Brand name
   * alone (see module comment for why). */
  matchTerms: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns the ids of every candidate whose model/trim name appears as a
 * whole-word (or whole-phrase) match in the title, case-insensitively —
 * not merely a substring, so a short name like "GLE" doesn't match
 * inside an unrelated word like "Eagle" or "Glencore". */
export function extractCarModelMentions(title: string, candidates: CarModelCandidate[]): string[] {
  return candidates
    .filter((candidate) => candidate.matchTerms.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(title)))
    .map((candidate) => candidate.id);
}
