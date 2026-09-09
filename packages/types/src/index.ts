// Shared DTOs/types used across apps/web, apps/api, apps/worker.
// Deliberately small right now — grow this as real endpoints/pipeline
// stages need shared shapes, don't pre-invent types nothing consumes yet.

export interface IngestResult {
  sourceId: string;
  itemsSeen: number;
  articlesCreated: number;
  duplicatesSkipped: number;
  storiesCreated: number;
  storiesUpdated: number;
  errors: string[];
}

// packages/database/prisma/schema.prisma's EntityRelation model has no
// real foreign key on fromId/toId (deliberate — see that model's own
// comment), and its "fromType"/"toType" columns are bare strings, not a
// DB enum. docs/database.md claims these are "validated in application
// code" — found 2026-09-07 that no such validation existed anywhere;
// every write site (apps/worker/src/ingest.ts,
// packages/database/src/seed.ts) just wrote raw string literals like
// "story"/"car_model" with nothing to catch a typo. A typo here doesn't
// crash — it silently creates a real row that the read-path query (e.g.
// `where: { toType: "car_model" }`) just never matches, exactly the
// "orphaned data nobody notices" failure mode. This constant object makes
// that a compile error instead: every write/read site uses
// `ENTITY_TYPE.X`, so a typo'd type string can't type-check. Lives here
// (not packages/editorial) since the three call sites — apps/api,
// apps/worker, packages/database's seed script — don't all already
// depend on packages/editorial, and this package has zero dependencies
// of its own to create a cycle with.
export const ENTITY_TYPE = {
  STORY: "story",
  CAR_MODEL: "car_model",
  PERSON: "person",
  COMPANY: "company",
  ARTICLE: "article",
} as const;

export type EntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];
