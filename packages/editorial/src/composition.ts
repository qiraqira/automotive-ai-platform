import type { ArticleStatus, ContentPurpose } from "@automotive/database";

// The ContentCompositionEngine (extension §4-§6, §50): before an AIJob is
// even allowed to draft an article, this decides whether the result should
// be a brand-new article, an update to an existing one, a merge/split of
// existing coverage, or a rejection because it adds nothing new. This is a
// pure function on purpose — no DB/AI calls in here — so the actual
// decision logic can be fully unit-tested without a live database or an
// AI provider (neither is guaranteed to be available, see docs/deployment.md).

// Real gap found and checked 2026-09-08 (documentation, not a bug):
// docs/editorial-system.md's own "Cannibalization prevention" table
// names all 5 of these as this engine's real outcomes, but
// decideComposition() below only ever returns 4 of them — SPLIT
// ("one existing article has grown to cover two distinct purposes", per
// that same table) is never produced. Confirmed this is correctly
// deferred, not an oversight: detecting it requires understanding an
// EXISTING article's actual current content well enough to tell it now
// straddles two purposes — this function only ever sees an existing
// article's already-assigned single `contentPurpose` + status (see
// ExistingArticleForComposition below), which structurally cannot
// express "this one article's content has drifted to cover two topics."
// That's a real content-analysis capability this project doesn't have
// yet (the same AI-blocked category as the Quality Gate/AIProvider
// rows in README — not buildable from pure metadata today). Kept SPLIT
// in the public type since it's a real, spec-documented future outcome
// this function's callers should already be prepared to handle, not
// removed just because nothing produces it yet.
export type CompositionDecision = "CREATE" | "UPDATE" | "MERGE" | "SPLIT" | "REJECT";

const ARCHIVED_STATUSES: ArticleStatus[] = ["ARCHIVED", "REJECTED"];

export interface ExistingArticleForComposition {
  id: string;
  contentPurpose: ContentPurpose;
  status: ArticleStatus;
}

export interface CompositionInput {
  desiredPurpose: ContentPurpose;
  existingArticles: ExistingArticleForComposition[];
  /** How much genuinely new information this Story/Fact update carries
   * over what's already published — see docs/editorial-system.md
   * "KnowledgeDelta". 0 means nothing new. */
  knowledgeDelta: number;
}

export interface CompositionResult {
  decision: CompositionDecision;
  targetArticleId?: string;
  reason: string;
}

export function decideComposition(input: CompositionInput): CompositionResult {
  const live = input.existingArticles.filter((a) => !ARCHIVED_STATUSES.includes(a.status));
  const samePurpose = live.filter((a) => a.contentPurpose === input.desiredPurpose);

  if (samePurpose.length > 1) {
    // Two or more live articles already claim the same purpose for the
    // same story/car — that's drift the composition engine should have
    // prevented earlier; surface it as MERGE rather than silently adding
    // a third.
    return {
      decision: "MERGE",
      reason: `${samePurpose.length} existing live articles already share contentPurpose "${input.desiredPurpose}" — merge them instead of adding another.`,
    };
  }

  if (samePurpose.length === 1) {
    const existing = samePurpose[0]!;
    if (input.knowledgeDelta > 0) {
      return {
        decision: "UPDATE",
        targetArticleId: existing.id,
        reason: `An article with contentPurpose "${input.desiredPurpose}" already exists (${existing.id}) and there is new information (knowledgeDelta=${input.knowledgeDelta}) — extend it instead of forking.`,
      };
    }
    return {
      decision: "REJECT",
      targetArticleId: existing.id,
      reason: `An article with contentPurpose "${input.desiredPurpose}" already exists (${existing.id}) and knowledgeDelta is ${input.knowledgeDelta} — nothing new to publish.`,
    };
  }

  return {
    decision: "CREATE",
    reason: `No live article covers contentPurpose "${input.desiredPurpose}" yet for this story/car.`,
  };
}
