# Database

Source of truth: `packages/database/prisma/schema.prisma` (**50 tables**
— corrected 2026-09-08, counted directly via `grep -c "^model "` rather
than trusting the old "51" figure this doc and `README.md` both
repeated; migrated and verified against a real PostgreSQL 17 instance
during development — see "Local dev database" below). This document
explains the shape and the non-obvious decisions; read the schema file
for exact fields.

## ERD (entity groups and their relations)

```text
User ──< UserRole >── Role ──< RolePermission >── Permission
User ──< AuditLog (actorUserId)

Source ──< SourceArticle >── Story ──< StorySource >── Source
Source ──< SourceScoreEvent
Source ──< SourceAuthor (optional)
SourceArticle >── SourceAuthor
SourceArticle ──< FactEvidence >── Fact

Story ──< StoryEvent (timeline)
Story ──< Fact
Story ──< Article
Story >── Topic

Fact ──< FactEvidence
Fact ──< FactConflict (factA/factB self-referencing pair)
Fact >── CarModel
Fact >── Market

Article >── User (authorUserId, optional)
Article ──< ArticleBlock
Article ──< ArticleRevision
Article ──< ArticleImage >── Image >── ImageLicense
Article ──< RelatedArticle (self-referencing, from/to)
Article ──< Citation >── Fact (optional)
Citation >── SourceArticle (optional)
Article ──< EditorialReview
Article ──< Comment
Article ──  SEORecord (1:1)
Article ──< ArticleCarModel >── CarModel

Brand ──< CarModel ──< Generation ──< Trim ──< Engine
                                            └─< Battery

Person, Company, Story ──< EntityRelation >── (any entity, polymorphic)

AIJob ──< AIExecution >── PromptTemplate ──< PromptVersion
AIAgentAction (standalone action log)
```

## Non-obvious decisions

### 1. Embeddings: `Float[]` now, `vector(N)` later

`SourceArticle.embedding` is a plain `Float[]` column, not pgvector's
`vector` type. Reason: the pgvector extension isn't installed in this
machine's local Postgres 17 (it's a bare EDB Windows install — no
`CREATE EXTENSION vector` available), and blocking the *entire* schema
migration on an extension not guaranteed to exist would have meant not
being able to verify any of the other 50 tables against a real database
either.

Production runs Postgres via the `pgvector/pgvector` Docker image (see
`infrastructure/docker/docker-compose.yml`), where the extension is
present. Before relying on real vector search there, run a follow-up
migration: `ALTER TABLE source_articles ALTER COLUMN embedding TYPE
vector(1536) USING embedding::vector; CREATE INDEX ... USING ivfflat
(embedding vector_cosine_ops);` — and update `findClusterCandidate()`
in `apps/worker/src/ingest.ts` to add a `<=>` embedding-distance term
alongside its existing `similarity()` (`pg_trgm`) query. Until then,
duplicate/clustering detection runs entirely on `pg_trgm` title
similarity (already enabled locally) via that same function, which is
enough for the MVP duplicate-detection slice.

**Corrected 2026-09-08**: this note previously said to update
`packages/search` — that package is a real directory
(`packages/search/`) but has been completely empty (no `package.json`,
no source files) since before this session started; it has never held
any real code. All real clustering/similarity logic lives in
`apps/worker/src/ingest.ts` today, confirmed by grepping the whole
`apps/` tree for `cosine`/`similarity`/`embedding` — this is the only
file with real matches. Left the empty directory in place rather than
deleting it (same posture as the `Category`/`Tag` schema finding
elsewhere in this doc: genuine uncertainty about whether it's
deliberate forward-provisioning for Phase 2 or a stray leftover, so
document rather than remove without being sure) — but fixed this
pointer since a future implementer following it verbatim would have
edited a package with nothing in it.

### 2. English/Spanish are editions, not translations

`Article.locale` + `Article.editionGroupId` (nullable, shared across the EN
and ES article that cover the same story) replace the spec's literal
`ArticleTranslation` entity. This is intentional, not an oversight — see
docs/editorial-system.md for why a translation-table model would have
encoded exactly the anti-pattern the spec explicitly rules out (§3, §20-21).

### 3. Facts are append-only and scoped, never overwritten

A `Fact` row is keyed by (subject, attribute, market, time window), not just
(subject, attribute). A later, different claim is a *new* `Fact` row;
`FactConflict` links two simultaneously-valid, disagreeing facts pending
resolution. This directly implements spec §14-15 and §90-91 — never
"pick a number and overwrite."

### 4. Knowledge-graph edges are one generic table

`EntityRelation(fromType, fromId, toType, toId, relation, weight)` connects
any two entities (Story↔Car, Article↔Technology, Company↔Person, ...)
instead of a join table per entity-type pair. Prisma has no native
polymorphic relation, so `fromId`/`toId` aren't backed by a real foreign
key — deliberate, since the whole point of this table is to connect
heterogeneous types. `fromType`/`toType` are validated at compile time,
not runtime: `packages/types`' `ENTITY_TYPE` const object (found and
fixed 2026-09-07 — this line used to claim runtime validation existed in
`packages/editorial`, but none did; every write site used raw string
literals with nothing to catch a typo, which would have silently
produced a row the read-path query just never matches). Every write/read
site now uses `ENTITY_TYPE.STORY`/`ENTITY_TYPE.CAR_MODEL`/etc., so a
typo'd type string fails to compile instead of silently corrupting data.

**The "no real foreign key" design above was itself a real migration,
not the original schema**: `fromId`/`toId` briefly had THREE
simultaneous real FK constraints (to `Story`, `Person`, and `Company`,
all on the same physical column) — impossible for a genuinely
polymorphic edge to ever satisfy, caught by the first real `INSERT`
attempt throwing Prisma's `P2003`. Migration
`20260907022400_fix_entity_relation_fake_fks` drops all three,
producing the current, correct design described above.

### 5. Time- and market-aware everything

No bare `price` or `range` field anywhere. Facts, and eventually
`CarSpecification`-shaped data feeding car pages, always carry
`market`/`validFrom`/`validTo`/`originalCurrency`/`originalValue` (spec
§90-93). Rendering picks the right unit/currency for the viewer's locale;
the stored value never loses the original.

### 6. The `pg_trgm` GIN index is a real `@@index`, not an unmanaged raw-SQL object

**Added 2026-09-08**, after a real, self-caused near-incident: the
`source_articles_title_trgm_idx` GIN index (created via raw SQL in the
`pg_trgm` migration, since Prisma's schema syntax had no representation
for it at the time) had zero presence in `schema.prisma` itself — so
every later `prisma migrate dev` run's own schema diff concluded the
index shouldn't exist and silently queued a `DROP INDEX` for it. This
was caught live, not assumed: adding 3 unrelated pagination indexes
elsewhere triggered exactly this, and the generated migration really
did drop the real index from the real database when applied (confirmed
via `pg_indexes`) — a genuine regression to the duplicate-detection/
clustering pipeline the whole ingestion system depends on, caused while
fixing something unrelated.

Fixed for real, not just patched around: this Prisma version
(`5.22.0`) supports declaring an extended index type directly —
verified live via `prisma validate`/`prisma migrate diff`, no preview
feature flag needed:

```prisma
@@index([title(ops: raw("gin_trgm_ops"))], type: Gin, map: "source_articles_title_trgm_idx")
```

The explicit `map:` preserves the real index's exact existing name, so
adding this produced a genuinely EMPTY migration diff (verified via
`prisma migrate diff --script`) — the schema now accurately describes
what's already there, no database change needed. This closes the
landmine for good: any future `prisma migrate dev` run will correctly
see this index as already matching the schema, not something to drop.

### 7. Prisma migration history is append-only, even to fix your own mistake

Learned the hard way in the same tick as the note above: once a
migration is applied, its `.sql` file's content is checksummed and
recorded — editing that file afterward (tried once, reverted) breaks
the guarantee anyone re-applying migration history from scratch depends
on. The correct way to fix a migration that did something wrong is a
new, separate migration that corrects the end state, never editing the
original. `prisma migrate status` alone didn't flag the broken checksum
from the edit attempt — checking `_prisma_migrations`' own recorded
`checksum` column directly is what actually caught it.

### 8. `Category` and `Tag` exist in the schema but connect to nothing

Found 2026-09-08 during a fresh review of every model, checked rather
than assumed: unlike every other not-yet-wired-up model in this schema
(`AIJob`, `Image`, `Comment`, etc. — each missing only a real write
path, but still tied into the graph via real relation fields, and each
with a real spec/doc section describing its intended use), `Category`
and `Tag` have neither. Grepped the whole codebase: zero application
code references `prisma.category`/`prisma.tag` anywhere. Grepped every
`docs/*.md` file and this doc's own ERD above: zero mentions of either
model anywhere, not even as a deferred/future item. No other model
declares a relation field pointing at either one. `Topic` (real
`stories Story[]` relation, real application code and tests) already
covers the "classify content" role these two might once have been
intended for.

Left both in the schema rather than removed — real uncertainty about
intent (an early draft superseded by `Topic` and never cleaned up?
forward provisioning for a future Article-level classification
distinct from Story-level Topic, never written down anywhere?) is a
reason to document clearly, not a reason to delete without being sure.
The full 180-section spec this project was built from isn't available
in this doc or in any saved file (see the project memory's own opening
note) — a future session with access to it, or the user directly,
could resolve this with certainty either way. Also matching comments
added directly on both models in `schema.prisma` itself.

### 9. `Citation.factId`/`sourceArticleId` gained real relations, 2026-09-08

A real, fixable gap found in the same review pass as #8 above, but
unlike that one, this one had a clear, low-risk fix rather than genuine
ambiguity. `Citation.factId`/`sourceArticleId` had no `@relation`
declaration at all — bare, unlinked `String?` columns — while
`Citation.articleId` right above them correctly did. Unlike
`EntityRelation`/`AIAgentAction`'s deliberately polymorphic edges (one
column that can point at any of several types, correctly left as a
plain `String` since Prisma has no native polymorphic relation),
`factId`/`sourceArticleId` each point at exactly one concrete,
non-polymorphic model — there was no structural reason for these two to
differ from `articleId`. Added the missing real relations (`Citation.fact
Fact?`/`Citation.sourceArticle SourceArticle?`, both still correctly
optional — a citation can reference a general source with no specific
extracted Fact, or vice versa) plus the matching reciprocal `citations
Citation[]` fields on both `Fact` and `SourceArticle`.

Verified via `prisma migrate diff` before applying anything: a real
(not empty) two-line diff, exactly the two new `ADD CONSTRAINT`
statements and nothing else — no unintended drops, the exact discipline
this project's own trigram-index incident (#6 above) established.
Applied via a real `prisma migrate dev` (migration
`20260908051629_add_citation_fact_source_article_relations`), safe
given zero real `Citation` rows exist yet to violate the new FK
constraints. Confirmed live against real Postgres constraint metadata
(`pg_constraint`/`pg_get_constraintdef`) that all three real FKs
(`articleId`, `factId`, `sourceArticleId`) now exist exactly as
declared — not just trusting Prisma's own tooling. Full regression
sweep clean afterward: typecheck (all 10 workspaces), 282/282 unit/
integration tests, 66/66 E2E.

### 10. `SourceAuthor.sourceId` gained a real relation, same day — this one was LIVE, not dormant

Found immediately after #9, continuing the same fresh review, but a
meaningfully different situation: `SourceAuthor` is **not** a 0%-built
table like `Citation` — `apps/worker/src/ingest.ts`'s real
`resolveSourceAuthor()` already creates real rows during real RSS
ingestion (9 real rows in this dev DB at the time of this fix).
`sourceId` had the identical shape of gap (a bare, unlinked `String?`,
no `@relation`, no reciprocal field on `Source`), but because real data
already existed, this needed one extra safety check before touching
anything: queried every real `SourceAuthor` row live and confirmed all
9 have a genuine, valid `sourceId` (zero `null`, zero pointing at a
`Source` that doesn't exist) — only then was it safe to add a real FK
constraint without risking the migration failing against real,
already-written data.

The gap itself was never a functional bug — `resolveSourceAuthor()`'s
own `findFirst({ where: { sourceId, name } })` filters on the raw
scalar column directly, which works identically with or without a
declared relation. The fix (adding `SourceAuthor.source Source?` and
the reciprocal `Source.authors SourceAuthor[]`) closes the missing FK
constraint and missing `include`-ability, matching #9's fix. Same
verification discipline: `prisma migrate diff` showed a real, minimal
one-line diff before applying anything; applied via `prisma migrate
dev` (migration `20260908052845_add_source_author_source_relation`);
confirmed live against real `pg_constraint` metadata that the FK exists
exactly as declared; full regression sweep clean afterward (typecheck,
282/282, 66/66 E2E) — the extra e2e run specifically because, unlike
#9, this table has real, currently-flowing data through it.

### 11. `Article.authorUserId` gained a real relation too — found via a systematic sweep, not another spot-check

After finding the identical gap twice by manual spot-checking (#9, #10),
switched approach: wrote a small script scanning every `*Id String`
field in the whole schema for whether the very next line declares a
`@relation` for it. Most matches were false positives from the script's
own simplicity (junction-table composite keys where the relation
appears two lines down; `AuditLog.actorUserId`, whose relation is
validly declared just *before* its own scalar field — Prisma allows
either order) or already-confirmed deliberate polymorphism
(`EntityRelation`/`AIAgentAction`'s own `entityId`/`fromId`/`toId`).
One real hit: `Article.authorUserId` — bare, unlinked, while
`ArticleRevision.authorUserId` (identical concept, right there in the
same schema) already does this correctly. `Article` has zero real rows
(0% built, matches `Citation`'s dormant status, not `SourceAuthor`'s
live one) — no live-data safety check needed. Added
`Article.author User?` and the reciprocal `User.articles Article[]`.
Same verification chain: `prisma migrate diff` showed a real, minimal
one-line diff; applied via `prisma migrate dev` (migration
`20260908053909_add_article_author_user_relation`); confirmed live
against real `pg_constraint` metadata. Ran the FULL regression sweep
including E2E despite `Article` itself being dormant — `User` is not:
it's central to every real auth/admin flow, and this change alters
`User`'s own generated Prisma type, so the extra confidence was
warranted even though the new relation's *other* end has no data yet.
Typecheck (all 10 workspaces), 282/282, 66/66 E2E all clean.

**While investigating this one, checked something with real stakes
directly**: `User.status` defaults to `UserStatus @default(INVITED)`
in the schema (not `ACTIVE`) — worth checking immediately whether the
one real user-creation endpoint (`POST /v1/users`) relies on that
default or overrides it, since relying on it would mean every
admin-created user starts unable to log in. Read the real handler
directly: it explicitly sets `status: "ACTIVE"` in its `prisma.user.
create()` call — the schema default is never actually reached by real
code. Confirmed safe, not a live bug, but worth naming as a real
footgun for any FUTURE code that creates a `User` without remembering
to override the default explicitly. Added an inline schema comment on
`User.status` itself (not just here) naming the real handler that
overrides it — someone reading the schema in isolation, without this
doc open, should still see the footgun.

## Local dev database

This machine already had PostgreSQL 17 and Redis running as Windows
services from an unrelated, pre-existing setup whose credentials are
unknown — rather than touch that instance, a **second, fully isolated**
Postgres cluster was initialized specifically for this project:

- Data directory: `infrastructure/local-pgdata` (gitignored)
- Port: `5488` (not the default 5432, so it can never collide with the
  pre-existing instance)
- Role: `automotive` — password set at `initdb` time, see local
  `.env`/shell history, not committed
- Start/stop: `pg_ctl -D infrastructure/local-pgdata start` /  `... stop`
  (the same `pg_ctl.exe` that ships with the existing PostgreSQL 17 install
  works fine against this separate data directory)

Production does not use this pattern — see docs/deployment.md, which runs
Postgres from the official Docker image with pgvector baked in.

## Local dev Redis

The pre-existing Windows Redis on this machine is version **3.0.504** (a
~2016-era Windows port) — too old for BullMQ, which hard-requires >=5.0.0
(confirmed the hard way: it refuses to connect at all, `Redis version
needs to be greater or equal than 5.0.0 Current: 3.0.504`). Following the
same isolated-instance pattern as Postgres above, a real modern Redis was
set up specifically for this project, 2026-09-07, after explicit user
go-ahead (downloading and running a third-party binary isn't a decision
to make silently):

- Binary: Redis **8.10.1** for Windows, a portable zip build from
  [redis-windows/redis-windows](https://github.com/redis-windows/redis-windows)
  (an actively-maintained community project — the official Redis project
  doesn't publish Windows binaries) — extracted to
  `infrastructure/redis-windows-bin/` (gitignored, ~14MB, not committed)
- Data directory: `infrastructure/local-redis-data/` (gitignored)
- Port: `6390` (not the default 6379, so it can never collide with the
  pre-existing incompatible instance)
- Start: `infrastructure/redis-windows-bin/Redis-8.10.1-Windows-x64-msys2/redis-server.exe --port 6390 --dir infrastructure/local-redis-data`
- `REDIS_URL` for this local instance: `redis://localhost:6390`

This unblocked the real BullMQ migration for `apps/worker`'s scheduler
(see README's status table) — before this, it was a plain `setInterval`
loop with no queue, retries, or persistence.

Production does not use this pattern — see docs/deployment.md, which runs
Redis from the official `redis:7-alpine` Docker image (also what
`.github/workflows/ci.yml`'s Redis service container uses).

## Migrations

**Corrected 2026-09-08, twice — second correction changes the
maintenance approach, not just the count**: this section originally
claimed `..._init` was "the current single migration," then got a
same-day fix naming 3 more real migrations that had landed since. That
fix itself was already stale again within the same day — 3 MORE real
migrations landed after it was written (`add_missing_pagination_
indexes`, `restore_trgm_index_prisma_diff_dropped`, and
`add_citation_fact_source_article_relations`). Hand-enumerating every
migration by name (or even just its count) here has now demonstrably
rotted twice in one day — the same "a fast-changing list will rot,
point at the real source instead of re-maintaining a copy" lesson
already applied to `docs/architecture.md`'s API-endpoint-list section.
**Real source of truth from here on, no count hardcoded here either**
(a hand-typed count is exactly as perishable as a hand-typed list — 2
more migrations landed the same day this section's own "7 total" was
written, proving the point): the real
`packages/database/prisma/migrations/` directory itself — `ls
packages/database/prisma/migrations/` (ignore `migration_lock.toml`)
for the current count and names, and read a specific migration's own
`migration.sql` for exactly what it does, same as always. This doc's
"non-obvious decisions" section above still calls out specific
migrations by name where the STORY behind them matters (the trigram-
index incident, the EntityRelation fake-FK fix, this pass's Citation
relations) — that's the right place for narrative, not a flat list here
that only ever restates the directory listing. Never hand-edit a
production database — all schema changes go through `prisma migrate
dev` locally, committed, then `prisma migrate deploy` in CI/deployment
(spec §58).
