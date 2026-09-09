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

export interface CarModelCandidate {
  id: string;
  /** The model's own name plus its real trim names — never a Brand name
   * alone (see module comment for why). */
  matchTerms: string[];
}

/** Returns the ids of every candidate whose model/trim name appears as a
 * substring of the title (case-insensitive). */
export function extractCarModelMentions(title: string, candidates: CarModelCandidate[]): string[] {
  const lower = title.toLowerCase();
  return candidates
    .filter((candidate) => candidate.matchTerms.some((term) => lower.includes(term.toLowerCase())))
    .map((candidate) => candidate.id);
}
