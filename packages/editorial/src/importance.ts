// Real gap found and fixed 2026-09-07: `Story.importanceScore` — the
// single most heavily-weighted input to `computeRankingScore()`
// (`ranking.ts`'s own WEIGHTS.importance is 0.35, the largest of the
// five) — has sat at its schema default (30) for every Story ever
// ingested. Nothing anywhere ever set it to anything else outside one
// manual test mutation. Confirmed live before writing this: 149 real
// Stories in this dev DB, exactly 1 with 2+ real distinct sources
// covering it, and that one still stuck at 30 like every single-source
// story. The homepage's real ranking algorithm was real math running on
// a dead constant for its biggest weight.
//
// Deliberately based on *distinct source count*, not
// `source-independence.ts`'s origin-deduplicated count: that module's
// own comment says it isn't wired to real citation extraction yet (needs
// an AI research stage to detect an article's `originUrl` from its
// text, which doesn't exist) — using it here would silently treat 3
// outlets that turn out to all be reprinting one press release as more
// "important" than they actually are. Plain distinct-source count is a
// real, honest, currently-computable signal on its own: more outlets
// independently choosing to cover something is still a genuine
// editorial signal, just a cruder one than the fully origin-aware
// version this will graduate to once that AI stage exists.

const BASE_SCORE = 30; // matches the schema default for a brand-new, single-source story — no regression for the common case
const SCORE_PER_ADDITIONAL_SOURCE = 25;
const MAX_SCORE = 100;

/** `sourceCount` is the real, current count of distinct Sources covering
 * a Story (`StorySource` rows) — always ≥1 for any Story that exists at
 * all. Diminishing returns via the same cap-at-100 shape `ranking.ts`
 * uses everywhere else, not an unbounded score. */
export function computeImportanceScore(sourceCount: number): number {
  const extra = Math.max(0, sourceCount - 1);
  return Math.min(MAX_SCORE, BASE_SCORE + extra * SCORE_PER_ADDITIONAL_SOURCE);
}
