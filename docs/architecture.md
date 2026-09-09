# Architecture

`PROJECT_NAME` / `DOMAIN.COM` are placeholders throughout this codebase (env
vars `PROJECT_NAME`, `PUBLIC_DOMAIN`, `PUBLIC_URL` — see `.env.example`).
Nothing in `apps/` or `packages/` hardcodes a brand name.

## System diagram

```text
                         INTERNET
                            |
                        CDN / WAF
                            |
                      NEXT.JS WEB (apps/web)
                            |
                       API (apps/api)
                            |
        +-------------------+-------------------+
        |                   |                   |
    PostgreSQL            Redis              S3-compatible
  (packages/database)   (BullMQ queues)        storage
        |                   |
        |              Job Queue
        |                   |
        +---------- Workers (apps/worker) -------+
                            |
                    AI ORCHESTRATOR (packages/ai)
                            |
        +-------------------+-------------------+
        |                   |                   |
    AI Provider        Search/Research         Vision
  (Anthropic/OpenAI/    (source fetch +       (image
   local — abstracted    web research)        understanding,
   behind AIProvider)                          future)
```

## Why modular monolith, not microservices

Three deployables (`web`, `api`, `worker`) sharing one Postgres database and
one set of `packages/*` libraries. Workers and API both depend on
`packages/database`, `packages/ai`, `packages/editorial`, `packages/seo`
as plain TypeScript packages, not network services. This is deliberate:

- One story's processing pipeline (cluster → research → fact-check → write →
  quality-gate → publish) is a sequence of steps that share a lot of context
  (the Story, its Facts, its ResearchPackage). Splitting that into
  network-separated microservices this early would mean serializing that
  shared context over HTTP for no operational benefit yet.
- The system does need to scale workers independently of the web tier
  (AI jobs are bursty and CPU/IO-bound in different ways than page rendering)
  — that's why `worker` is already a separate deployable/process from `api`,
  talking through Redis/BullMQ, not a function call. That's the one seam
  that was worth paying for on day one.
- If/when a specific piece (e.g. the Fact Engine, or Search) needs to scale
  or be owned by a different team, it already lives in its own `packages/*`
  boundary with an explicit interface — extracting it into its own service
  later is a deployment change, not a rewrite.

## Repository layout

```text
/apps
  /web      Next.js (App Router), public site + admin UI, SSR/ISR
  /api      REST API (Node/TypeScript), auth, CRUD, webhooks
  /worker   BullMQ workers: ingestion, clustering, AI pipeline stages, cron

/packages
  /database  Prisma schema + client (packages/database/prisma/schema.prisma)
  /ai        AIProvider abstraction, prompt management, AI pipeline stages
  /types     Shared TypeScript types/DTOs across apps
  /config    Env var loading/validation (one schema, imported everywhere)
  /utils     URL hashing, text similarity, unit conversion, etc.
  /editorial editorial rules: content purpose, cannibalization checks,
             composition engine, value scoring
  /seo       structured data builders, sitemap/hreflang generation
  /search    empty placeholder, not yet populated — **corrected 2026-09-08**:
             this row used to claim real query-building code lived here;
             checked directly and the directory has zero files (not even
             a package.json, so `npm --workspaces` silently skips it). The
             real `GET /v1/search` query-building (pg_trgm `similarity()`
             against Postgres) lives inline in `apps/api/src/app.ts`
             instead — never actually split out. Left as a real, honest
             placeholder for that future split rather than deleted, since
             an empty directory isn't tracked by git either way (nothing
             to clean up), but no longer described as already holding code
             it doesn't.

/infrastructure
  /docker    Dockerfiles per app
  /nginx     reverse proxy config (TLS termination, routing)
  /scripts   backup/restore, deploy helpers

/docs        this file and its siblings
```

## Data flow (happy path, see docs/ai-pipeline.md for detail)

```text
Source (RSS/API) → SourceArticle → duplicate/story-clustering
  → Story → Fact extraction → Fact conflict detection → Research
  → Editorial synthesis → English edition → Spanish edition
  → Quality Gate → Publication → Knowledge Graph update
```

## Deployment model

Single Docker host running `docker compose` (see
`infrastructure/docker/docker-compose.yml`): Postgres, Redis, MinIO (or a
real S3-compatible provider in production), `api`, `worker`, `web`, Nginx.
No Kubernetes for the MVP (spec §78). See docs/deployment.md.

## API endpoints (MVP surface) — original planning sketch, NOT the current route list

**Corrected 2026-09-08**: the endpoint list below is the ORIGINAL,
early-project MVP-scope sketch — kept for historical context, not
re-synced to match reality. Checked directly against `apps/api/src/
app.ts`'s real registered routes (not assumed): almost none of this
list is still accurate. Several endpoints below were never built this
way at all (the whole Articles/Comments/AI-operations sections —
`Article`/`Comment` don't exist yet, no AI pipeline exists to have
jobs/executions/a kill-switch endpoint; `GET /v1/stories/:id` and
`POST /v1/sources/:id/trigger` specifically were never built either).
Meanwhile roughly 30 real, live, tested routes this session actually
built are entirely missing from this list — brands, car generations/
trims/engines/batteries, redirects, alerts, audit log, user management,
markets, topics, analytics, search-query observability, and more.

This isn't worth hand-maintaining as an exhaustive, always-current
route list here — `README.md`'s status table already documents every
real endpoint in far more exhaustive, dated, tested detail than a bare
path list ever could, and this same file's own "What's actually built
vs. designed-for" section below already learned the hard way (three
corrections in one day) that a prose summary of the admin surface goes
stale fast on days this dense with changes; an endpoint list would rot
identically. The real, current, ground-truth route list is `apps/api/
src/app.ts` itself — grep it for `app.(get|post|patch|delete)(` for
what's actually registered right now, rather than trusting this
section (kept below unchanged, as the historical planning artifact it
now honestly is).

REST, `apps/api`, versioned under `/v1`. Only what the current vertical
slice + near-term admin needs — not a speculative full surface for
features that don't exist yet.

```text
GET    /health
GET    /ready

# Public read surface (also what apps/web's SSR/ISR fetches from)
GET    /v1/articles?locale=&type=&limit=&cursor=
GET    /v1/articles/:locale/:slug
GET    /v1/stories/:id
GET    /v1/cars/:brandSlug/:modelSlug
GET    /v1/search?q=&locale=

# Sources (admin)
GET    /v1/sources
POST   /v1/sources                 [MANAGE_SOURCES]
PATCH  /v1/sources/:id             [MANAGE_SOURCES]
POST   /v1/sources/:id/trigger     [MANAGE_SOURCES]  — force an ingestion run now

# Stories (admin / editorial queue)
GET    /v1/stories?status=
PATCH  /v1/stories/:id             [UPDATE_STORY]

# Articles (admin / editorial queue)
GET    /v1/articles/queue?status=IN_REVIEW
POST   /v1/articles                [CREATE_ARTICLE]
PATCH  /v1/articles/:id            [UPDATE_ARTICLE]
POST   /v1/articles/:id/publish    [PUBLISH_ARTICLE]
POST   /v1/articles/:id/reject     [UPDATE_ARTICLE]
DELETE /v1/articles/:id            [DELETE_ARTICLE]

# Comments
POST   /v1/articles/:id/comments               — rate-limited, anonymous
PATCH  /v1/comments/:id/moderate   [MODERATE_COMMENT]

# AI operations (admin)
GET    /v1/ai/jobs?status=
GET    /v1/ai/executions?since=    — cost/usage reporting
POST   /v1/ai/kill-switch          [MANAGE_SYSTEM_SETTINGS]

# Auth
POST   /v1/auth/login
POST   /v1/auth/logout
GET    /v1/auth/me
```

Every mutating endpoint checks the caller's `RolePermission` set
(docs/security.md) before touching the database — including when the
caller is the AI agent's own service account, not just human sessions.

## What's actually built vs. designed-for

Being explicit about this so nobody mistakes a schema for a working feature
— see the root `README.md` status table for the exhaustive, actively
maintained current line; the summary below is a quick pointer, not the
source of truth:

- **Built and verified against a real database**: full schema (50 tables — corrected 2026-09-08, see `docs/database.md`),
  RSS ingestion → SourceArticle → duplicate detection → Story clustering →
  Topic classification → real byline extraction (where a source's feed
  provides one) → a real robots.txt compliance check before every fetch.
  `apps/api` (auth/RBAC/audit logging, public reads, search, cars, topics,
  redirects, analytics, alerts, plus real admin mutations: full source
  management — including adding a brand-new source, not just correcting
  an existing one, plus its real trust-score history — user management,
  and full real Knowledge Graph management: create *and* correct for
  every one of Brand/CarModel/Generation/Trim/Engine/Battery, not just
  correcting an existing car's Facts, plus redirect management)
  and `apps/web` (the full public site — homepage, car/topic pages,
  search, `/about/*` — and eight real admin pages: login/dashboard,
  stories, alerts, audit log, users, cars, redirects, analytics, all with
  real logout), all with a real E2E test suite on top of unit/integration
  tests. Permission system (RBAC) is enforced end-to-end by real DB
  lookups, not a stub. **Corrected here 2026-09-07** (a third time in one
  day — this section has now drifted out of date with the code three
  times in a single session, every time caught by re-reading it against
  the actual admin surface rather than trusting the previous correction
  to still hold, which is itself the actual lesson worth keeping: a
  summary like this one needs re-checking after *every* pass that
  touches the admin surface, not just once per day): the admin UI grew
  from 4 pages to 8 earlier the same day (audit log, users, cars,
  redirects, analytics), and this platform's entire real Knowledge Graph
  — Source, Brand, CarModel, Generation, Trim, Engine, Battery — went
  from "can only ever exist because `seed.ts` said so" to "a real editor
  can create and correct every one of them" later the same day, all
  through `/admin/cars` and `/admin` (Sources). A reminder that "built
  and verified" at the API layer doesn't imply a human could actually
  use it yet, and that this specific summary paragraph is exactly the
  kind of thing that silently rots the fastest on a day this dense with
  admin-surface changes.
- **Interfaces defined, not yet wired to a live provider**: `AIProvider`
  abstraction (`packages/ai`), AI job types, budget guard — no real AI
  provider (Anthropic/OpenAI) is wired in yet; blocked on an API key.
- **Designed in schema/docs, not yet implemented**: fact extraction,
  research engine, editorial synthesis/writing, quality gate (the scoring
  logic itself is built and unit-tested; nothing yet feeds it real AI
  output), Article pages/pipeline, AI Editorial Agent scheduler.
