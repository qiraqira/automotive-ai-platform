# Security & Permission Model

## RBAC (spec §40, schema: `User`/`Role`/`Permission`/`RolePermission`/`UserRole`)

A fixed enum of permissions (`PermissionKey` in
`packages/database/prisma/schema.prisma`) — every consequential action maps
to exactly one:

```text
READ_SOURCES        MANAGE_SOURCES       CREATE_STORY       UPDATE_STORY
CREATE_ARTICLE      UPDATE_ARTICLE       PUBLISH_ARTICLE    DELETE_ARTICLE
MODERATE_COMMENT    UPDATE_CAR           UPDATE_SEO         RUN_RESEARCH
GENERATE_IMAGE      MANAGE_USERS         MANAGE_AI_BUDGET   VIEW_AUDIT_LOG
MANAGE_SYSTEM_SETTINGS
```

An AI agent is a `User` row like any other (e.g. `email:
editorial-agent@internal`), assigned a `Role` (e.g. `ai_agent`) whose
`RolePermission` set is deliberately narrower than a human editor's —
`PUBLISH_ARTICLE` and `DELETE_ARTICLE` are not granted to that role until
the autonomy-level policy (docs/ai-pipeline.md) says they're safe to
automate. This is the same table and the same check the API uses for human
users — there's no separate, softer "AI bypass" path.

## Authentication

- Human users: password (**corrected 2026-09-08** — this used to say
  "bcrypt/argon2," implying either is in use; checked directly and only
  `bcryptjs` is, anywhere in the codebase — `argon2` isn't a dependency
  and is never imported. Real, current state: bcrypt hash, cost factor 12,
  `apps/api/src/auth.ts` — never plaintext, never reversible), session
  cookie (`AUTH_COOKIE_NAME`, `httpOnly`, `sameSite: "lax"`, `secure` in
  production).
- **CSRF**: **corrected 2026-09-08** — this line used to say "CSRF
  protection on any state-changing form" with no explanation of how,
  reading like a dedicated, named mechanism (a CSRF token, say) exists;
  checked directly and no code anywhere references "CSRF" at all. Real,
  current state, verified by tracing the actual browser-facing call
  graph rather than assumed: every real admin mutation is a plain HTML
  `<form method="post">` targeting `apps/web`'s own same-origin
  `/api/admin/*` routes, which then relay the real mutation to
  `apps/api` server-to-server (`apps/web/src/lib/admin-auth.ts`) — the
  browser itself never calls `apps/api` directly at all; the session
  cookie's `sameSite: "lax"` (set in
  `apps/api/src/app.ts`) is what actually blocks a cross-site auto-
  submitting form from carrying the victim's session, per SameSite
  Lax's own spec-defined behavior of withholding cookies on cross-site
  "unsafe" methods (POST/PUT/PATCH/DELETE) regardless of top-level
  navigation status. Layered with a second, independent check on every
  mutation: `apps/web/src/lib/admin-auth.ts`'s `requireAdminSession()`/
  `adminFetch()` always re-verify the forwarded cookie against a real
  `GET /v1/auth/me` call server-to-server, never trusting the cookie's
  mere presence. No CORS configuration exists on `apps/api` either, and
  that's correct, not a gap — since the browser never calls `apps/api`
  directly (as above), CORS is structurally irrelevant to this surface.
- Service-to-service (worker → API, if ever split further): signed JWT
  (`AUTH_JWT_SECRET`), never a shared static API key checked into anything.
- AI provider credentials (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, storage
  keys) live only in `apps/api`/`apps/worker` server environments — never
  shipped to `apps/web`'s client bundle. **Corrected 2026-09-08, twice
  the same day**: this used to say "`packages/config` is the only place
  that reads `process.env`... nothing else touches `process.env`
  directly," phrased broadly enough to read as a whole-codebase claim;
  checked directly and that's too strong. First correction undercounted
  it too — said "8 other files," found via a Bash `grep --include=*.ts`
  that silently excludes `.tsx` (a real, previously-unnoticed
  methodology gap in this session's own search habits — `.tsx` is most
  of `apps/web`'s real page/component code). Re-checked with both
  extensions included: **21 real files** read `process.env` directly
  outside `packages/config` — every real Server Component page under
  `apps/web/src/app/**` (each needs `PUBLIC_URL`/`PROJECT_NAME` for its
  own metadata/canonical URL), plus `proxy.ts`/`lib/admin-auth.ts`/
  `lib/api.ts`/the login route (`API_INTERNAL_URL`/`AUTH_COOKIE_NAME`),
  plus `packages/database`'s own `index.ts`/`seed.ts` (`NODE_ENV`), plus
  3 build/test-only files (`next.config.mjs`, `playwright.config.ts`,
  `scripts/run-next.mjs` — `NODE_ENV`/`CI`/`WEB_PORT`, never shipped or
  request-facing). Checked exactly which vars every one of the 21 reads
  before concluding this is still safe: only `PUBLIC_URL`/
  `PROJECT_NAME`/`API_INTERNAL_URL`/`AUTH_COOKIE_NAME`/`NODE_ENV`/`CI`/
  `WEB_PORT` — never `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/any
  `STORAGE_*` secret. So the substantive claim that actually matters
  still holds (`packages/config` genuinely is the only place any of
  these specific secrets are read, keeping them out of `apps/web`'s
  bundle), but stated precisely now instead of as an easily-falsifiable "nothing else touches
  `process.env`" absolute. **Verified 2026-09-08 at the deepest level
  available** — not just reading source code, but grepping the real
  COMPILED client-side JS in `apps/web/.next/static/chunks/*.js` (the
  actual bytes a real browser downloads and executes) for every secret
  name (`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`AUTH_JWT_SECRET`/
  `STORAGE_SECRET_ACCESS_KEY`/`STORAGE_ACCESS_KEY_ID`) and the real dev
  secret values themselves: zero matches. Confirmed this negative
  result is meaningful, not a broken search, by first grepping the same
  compiled bundle for known real client-side strings (the admin login
  page's own `/api/admin/login` fetch target, its "Invalid email or
  password" text) — both found immediately, proving the search
  methodology genuinely works on this artifact before trusting its
  silence on the secret search.

## Input handling

- Prisma parameterizes all queries — no raw string-concatenated SQL.
  Anywhere raw SQL is genuinely needed (the future pgvector migration, for
  instance), it uses Prisma's tagged-template `$queryRaw`, never string
  interpolation of user input.
- All API request bodies validated against a schema (zod) before touching
  the database — reject malformed input at the edge, not deep in business
  logic.
- Output encoding handled by React/Next.js by default (no `dangerouslySetInnerHTML`
  on anything derived from source/user content without explicit sanitization).

## No full-text mirroring

**Added 2026-09-07**: three separate places already pointed here by name
(`SourceArticle.excerpt` and `FactEvidence.quote` in
`packages/database/prisma/schema.prisma`, and
`apps/worker/src/backfill-authors.ts`'s own "no full-text mirroring"
comment) before this section actually existed — found while fixing an
unrelated wrong-file cross-reference on `Source.trustScore` and checking
every other doc pointer in the codebase for the same mistake. This is
the policy those comments were already assuming, written down for real:

This project never mirrors a source's full article text into its own
database, and never republishes one. `SourceArticle.excerpt` stores a
short excerpt only (the RSS feed's own summary field, not a scrape of
the full page); `FactEvidence.quote` is the same idea applied to a
single fact claim — a short, bounded quote used as evidence for one
specific extracted fact, not a substitute for reading the original
article. Every `SourceArticle` and `Fact` carries its real source
attribution (`Source`, `SourceArticle.url`) rather than presenting
excerpted text as this platform's own. This is a deliberate content
policy, not an accidental storage limitation — it's also *why*
`apps/worker/src/backfill-authors.ts` can only recover authors for
`SourceArticle` rows still present in a source's *current* feed window:
there's no full-text local copy to fall back on for an article that has
since scrolled out of the source's own feed.

## Rate limiting & anti-spam (spec §48)

**Corrected here 2026-09-07** — this section previously claimed the full
spec §48 design was already applied; it wasn't. Real, current state:
`apps/api/src/rate-limit.ts` is a real fixed-window limiter, keyed by IP
only (not IP+session — no session is required to hit any limited
endpoint), currently wired to three endpoints: login
(`POST /v1/auth/login`, 10 attempts/15min), search (`GET /v1/search`,
30/min), and analytics event logging (`POST /v1/analytics/events`,
120/min). Comment submission and contact/lead forms have no rate limiting
yet because neither endpoint exists yet (`Comment` is blocked on
`Article`; no contact-form endpoint has been built) — they'll join once
those features are real, not before. The CAPTCHA-equivalent challenge and
behavioral heuristics (submission speed, honeypot fields) from the fuller
spec §48 design are **not implemented** — the three real limiters above
are the first line of defense, not the whole anti-spam system. Cheap
checks still run before anything reaches the AI moderation stage
(docs/ai-pipeline.md) — that ordering principle held, even though the
checks themselves are narrower than originally documented here.

**Corrected again, same day**: `/v1/analytics/events` was initially
missed entirely from this accounting — it's a third real public,
unauthenticated write endpoint, hit automatically on every real page
navigation, and had no rate limit of any kind until this pass. Fixing
it surfaced a subtler issue specific to that one endpoint: it's only
ever called server-to-server from `apps/web/src/proxy.ts`'s internal
fetch to `apps/api`, not directly by the browser through the real nginx
hop that `app.set("trust proxy", 1)` (see `apps/api/src/app.ts`) is
built around — so naively keying by `req.ip` there would have collapsed
every real visitor onto `apps/web`'s own server address, either
disabling the limit in practice or throttling all real traffic
site-wide the moment any real usage crossed the threshold. Fixed by
having `proxy.ts` relay the real client's own `X-Forwarded-For` value
(the one nginx already set reaching `apps/web` itself) unchanged on that
internal call, so `apps/api`'s limiter genuinely keys per real visitor.
Verified directly (not assumed): a test simulating 121 requests from one
forwarded IP gets a real 429 on the 121st, while a different forwarded
IP in the same run is unaffected.

## Audit logging (spec §77, schema: `AuditLog`)

Every write that matters — human, AI, or system-initiated — writes one
`AuditLog` row: `actorType`, `actorLabel`, `action`, `entityType`/`entityId`,
`before`/`after` JSON, `reason` where applicable. This is separate from
`AIAgentAction` (docs/ai-pipeline.md), which is specifically the AI
decision log with `autonomyLevel` and `confidence` — `AuditLog` is the
general-purpose "who changed what" table any admin screen can query.

## Secrets

`.env.example` documents every variable with no real values. `.env` is
gitignored. Production secrets are injected by the deployment process
(docs/deployment.md), never committed.

**Corrected 2026-09-08**: this section previously claimed "log redaction
for any field matching `*_KEY`/`*_SECRET`/`*_TOKEN`/`*PASSWORD*`" as if
it were a real, implemented mechanism — it wasn't; no such redaction
logic exists anywhere in the codebase (checked directly, not assumed).
Real, current state: nothing here proactively redacts by field name,
because nothing today logs a dynamic, arbitrarily-keyed object that
could contain a secret in the first place — `request-logger.ts` logs a
fixed set of non-sensitive fields (timestamp/correlationId/method/path/
status/durationMs, never headers or body), and the global error handler
logs a string (`err.message`), not a keyed object a field-name filter
could apply to. The specific risk this originally seemed to guard
against — a real DB connection failure's error message leaking the
actual `DATABASE_URL` password, since `GET /ready` puts that message
directly in its response body for anyone to see — was checked live, not
assumed: both realistic Prisma connection-failure shapes (host
unreachable, wrong credentials) were reproduced against a real Prisma
client, and neither includes the actual password in its error text,
only the username and host. So the specific path that motivated this
claim doesn't currently leak anything — but the claim itself described
a generic safeguard that was never built, and would need building for
real (not assumed to already exist) the moment any future code starts
logging arbitrary keyed data.

## Observability

- `/health` — process is up.
- `/ready` — process is up **and** its dependencies are reachable — used
  by the reverse proxy/orchestrator to decide whether to route traffic to
  this instance. Currently checks Postgres only (`apps/api`'s one real
  dependency today — corrected here 2026-09-07, this used to say "DB,
  Redis" but `apps/api` doesn't talk to Redis at all yet: no BullMQ, no
  caching, nothing to check). Add a Redis check here once `apps/api`
  actually depends on it for something real — a check against a
  dependency the service doesn't use would be a fake health signal, not a
  real one.
- Structured (JSON) logs from `api`/`worker`, one log line per
  request/job with a correlation id.
- `SystemAlert` (schema) is the in-app channel for anything that needs a
  human's attention — crawler failures, AI provider outages, budget
  overruns, publish failures — independent of whatever external log/metrics
  aggregation gets added later.
