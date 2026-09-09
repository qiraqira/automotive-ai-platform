# Deployment

## Local development

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d postgres redis minio
npm install
cp .env.example .env   # fill in DATABASE_URL etc. to match the compose services
npm run db:migrate
npm run dev:api
npm run dev:worker
npm run dev:web
```

Note: this repository was developed on a machine where Docker wasn't
available locally, so the schema and the ingestion vertical slice were
verified against a manually-initialized, isolated local Postgres/Redis
instead (see docs/database.md "Local dev database"). The compose file below
is the real target for anyone with Docker — it's what production runs, not
a fiction.

## Production topology (spec §6, §78)

```text
                 Internet
                    |
              Nginx / Caddy (TLS, reverse proxy)
                    |
        +-----------+-----------+
        |                       |
   apps/web (Next.js)      apps/api (REST)
        |                       |
        +-----------+-----------+
                    |
              apps/worker (BullMQ consumers)
                    |
   +----------------+----------------+
   |                |                |
PostgreSQL        Redis        S3-compatible storage
(pgvector image) (queue)       (media, generated images)
```

`infrastructure/docker/docker-compose.yml` defines: `postgres`
(`pgvector/pgvector:pg17` — pgvector present from day one in this
environment, unlike local dev), `redis`, `minio` (swappable for a real
S3-compatible provider via `STORAGE_*` env vars), `api`, `worker`, `web`,
`nginx`, `certbot`. No Kubernetes for the MVP.

Target production host: a VPS in the Netherlands (spec §6) — no specific
provider hardcoded; `infrastructure/scripts` should stay provider-agnostic
(plain `docker compose`, `scp`/`rsync` for artifact transfer, standard
`certbot` for TLS) so it isn't tied to one host's control panel.

## TLS certificates

**Written 2026-09-07** alongside `infrastructure/nginx/nginx.conf` — that
file and the compose file's `certbot` service didn't exist before, so
this section previously had nothing real to document. Webroot mode:
`nginx` serves `/.well-known/acme-challenge/` from the shared
`certbot_webroot` volume; `certbot` (its own compose service) checks
every 12h whether the current certificate is due for renewal and renews
it in place via that same webroot — the two containers never need to
know about each other beyond the shared volumes.

The very first real certificate needs one manual, one-off bootstrap run
on the actual production host — real domain/email input, so it's
deliberately not baked into an unattended compose step:

```bash
docker compose -f infrastructure/docker/docker-compose.yml run --rm \
  -p 80:80 certbot certonly --standalone \
  -d DOMAIN.COM -d www.DOMAIN.COM \
  --email admin@DOMAIN.COM --agree-tos --no-eff-email
```

(`--standalone` here, not `--webroot`, since `nginx` won't successfully
start its `443` server block until a certificate already exists at
`/etc/letsencrypt/live/DOMAIN.COM/` — this one bootstrap run binds port
80 itself instead. Stop `nginx` first if it's already running and
holding port 80.) After that succeeds, start the full stack normally;
`certbot`'s renewal loop and `nginx`'s existing `443` block take over
from there with no further manual steps.

## CI/CD

**Corrected 2026-09-08**: this section previously described a full CI/CD
pipeline (build each app's Docker image, deploy over SSH) as if it already
existed — checked directly against the real `.github/workflows/ci.yml`
rather than assumed, and it's CI only, not CD: install, generate Prisma
client, migrate + seed (against the workflow's own ephemeral Postgres/
Redis service containers, purely to run the test suite — never a real
deployment target), typecheck, test, build, install Playwright, E2E. Zero
`docker build`/`docker push`/SSH/`compose`-related steps exist anywhere in
the real file. This isn't a regression — there's no real production host,
domain, or SSH target configured for this project yet (spec §6/§78's
production topology is written and reasoned through by hand in this
file, per the Docker Compose / Dockerfiles / Nginx status further down,
but never actually deployed anywhere) — so there was nothing for a real
CD step to deploy TO. Documented here as the honest current state rather
than continuing to describe an aspirational pipeline as if it were real.

**One more honest fact worth naming explicitly, 2026-09-08**: this
repo has zero git commits (by design — no commit has been requested
yet), so `.github/workflows/ci.yml`'s own `on: push`/`on:
pull_request` triggers have never actually fired even once — the
entire file, however carefully reasoned (its own top comment: "runs
exactly what a contributor runs locally"), has never been validated by
a real GitHub Actions run. Every command it contains has been run
locally, repeatedly, throughout this project's development (that's
where the real, current test/typecheck/e2e counts elsewhere in this
repo's docs come from) — but the YAML itself, the service-container
wiring, and whether it behaves identically in GitHub's own runner
environment remain unverified in the one place that actually matters.
Same "written and reasoned through by hand, not run-and-verified"
honesty already applied to the Dockerfiles/`nginx.conf` above — worth
a real first push (even to a throwaway branch) to confirm before
relying on this workflow for anything real.

**Corrected 2026-09-09 — a real production host exists now, this whole
section above is stale**: the site is live at **https://autonewsfeed.com**
(and `www.`), running as Docker Compose on a VPS at `147.45.156.155`
(`/opt/automotive-ai-platform`, containers `automotive-ai-platform-{web,
api,worker,redis,postgres}-1`, `pgvector/pgvector:pg17`), behind
Cloudflare (DNS resolves to Cloudflare edge IPs, not the origin directly).
Verified live 2026-09-09: real HTML from the real Next.js build (not a
placeholder), worker logs show genuine ongoing RSS ingestion, AI article
drafting, and real paid AI hero-image generation, zero errors in recent
API logs. **How it actually got there does NOT match the "CD" shape
described above**: the code on the server has no `.git` directory at all
— it was copied over directly (rsync/scp), not deployed via the
GitHub Actions pipeline sketched below, which has still never run for
real. This repo *does* now have real git history as of 2026-09-09 (first
commit `45771a5`, pushed to `github.com/qiraqira/automotive-ai-platform`,
default branch renamed `master` → `main` to match this very
workflow's `on: push: branches: [main]` trigger).

**Closed the same day**: the server's `/opt/automotive-ai-platform` now
has a real `.git` (`git init` + `remote add origin` + `fetch` + `reset
--mixed origin/main`, verified metadata-only — zero working-tree impact,
all 5 containers' uptime unaffected, site stayed live throughout), and a
real `git fetch origin && git merge --ff-only origin/main` has already
been run for real on the production host, bringing it from commit
`0a7e546` to `b432f3c` (the repo is public, so this needs no GitHub
credential at all — verified live, no token exists on the host).
`infrastructure/scripts/deploy.sh` now encodes the full real deploy
procedure (fetch, fast-forward-only merge, `prisma migrate deploy`,
rebuild the 3 app images, `--force-recreate`, re-verify the `webproxy`
network attachment) — see that file's own header comment for exactly
which parts have been run for real versus reasoned through by hand and
still awaiting a real end-to-end run. This repo's own git history and
what's actually running in production are no longer permanently
disconnected; **the CI workflow's own `on: push` trigger against GitHub
still does not itself deploy anywhere** — a real deploy is still a
manual `infrastructure/scripts/deploy.sh` run on the host, not yet an
automated step in `ci.yml` (see "When that's closed" below for that
still-unbuilt shape).

**When that's closed**, the intended shape (spec §6) is: on push to
`main`, after the existing test job passes, build each app's Docker
image, then deploy (compose pull + up -d) to the production host over
SSH, with migrations (`prisma migrate deploy`) run as an explicit step
before the new `api`/`worker` images go live — never as a side effect of
application boot, matching how this repo's local Dockerfiles/compose file
are already structured. **Never `npm run db:seed` against the production
`DATABASE_URL`** — see "Required production environment variables"
below.

## Required production environment variables

**Added 2026-09-07**, alongside two real startup guards this section
previously had nothing to document (this list didn't exist before
either fail-safe was written) — both are enforced by the app itself,
not just a convention someone has to remember:

- **`AUTH_JWT_SECRET`** (`packages/config/src/index.ts`) — has a
  development-only default (`"dev-only-insecure-secret-change-me"`,
  visible in this repo's own source) that is refused outright when
  `NODE_ENV=production`: `apps/api` throws at startup if this env var
  is left unset, still equal to that default, or under 32 characters.
  Generate a real one (e.g. `openssl rand -base64 48`) and set it
  before the first production deploy — a deploy that forgets this will
  fail loudly at container startup, not silently run with a
  known-insecure secret.
- **Never run `npm run db:seed` against the production `DATABASE_URL`**
  (`packages/database/src/seed.ts`) — it upserts a real, hardcoded,
  publicly-visible admin credential (`admin@dev.local` /
  `dev-admin-password`) for local-dev login testing. The script itself
  now refuses to run at all when `NODE_ENV=production`, as a second,
  code-level line of defense.

**Real production admin creation, built 2026-09-08** (previously
flagged here as "not built yet"): `npm run db:create-admin`
(`packages/database/src/create-admin.ts`) is the real, safe-in-production
counterpart to `db:seed`'s dev-only admin. It reads `ADMIN_EMAIL` /
`ADMIN_PASSWORD` (min 12 characters, refuses anything shorter) /
optional `ADMIN_NAME` from the environment — nothing hardcoded, nothing
printed to logs beyond the email — hashes the password, and upserts a
`User` with the `admin` Role. It requires that Role to already exist
(created by `bootstrapPlatformData()`, `packages/database/src/
bootstrap.ts` — the permissions/roles/markets/sources/topics half of
what used to be `seed.ts`, extracted out because it's real production
infrastructure, not dev fixture data) — refuses with a clear error
naming the missing prerequisite rather than silently creating a
roleless user. `bootstrap.ts` has its own CLI entry point (`npm run
db:bootstrap`), separate from `db:seed`, safe to run in production.
Real deploy order: `prisma migrate deploy` → `npm run db:bootstrap` →
`ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run db:create-admin`.

Both guards were verified live (real subprocess runs covering every
real combination — production+default secret throws, production+a
real secret boots, dev+default boots unaffected, and the same shape for
the seed script) before being written up here; see `README.md`'s "RBAC
middleware" row for the full verification detail.

## Backups (spec §80)

- **PostgreSQL**: nightly `pg_dump` to the S3-compatible storage bucket,
  retained on a rolling window (document the exact window once real data
  volume is known — don't guess a number now).
- **Object storage**: relies on the provider's own versioning/replication
  where available; document the specific provider's guarantees once chosen.
- **Configuration**: `.env` (production values) and
  `infrastructure/docker/docker-compose.yml` backed up alongside the
  database dump, since a restore needs both to mean anything.

Restore procedure (document precisely once backups exist for real, rather
than write an untested runbook): restore the Postgres dump into a fresh
`postgres` container, restore storage bucket contents, redeploy `api`/
`worker`/`web` against the restored `DATABASE_URL`, run `prisma migrate
deploy` if the dump predates a later migration.

## MVP scope (spec §81) — first vertical slice

```text
Source → RSS ingestion → SourceArticle → Duplicate detection → Story
  → AI summary → Fact extraction → Article generation → Quality check
  → English publication → Spanish publication → Homepage → Article page
  → Admin
```

Status against this list right now:

| Step | Status |
|---|---|
| Source → RSS ingestion → SourceArticle | **Built, tested against a real database** (`apps/worker`) |
| Duplicate detection | **Built** (URL hash + `pg_trgm` title similarity) |
| Story clustering | **Built** (rule-based; AI-assisted clustering behind `AUTO_CLUSTER`, not yet implemented) |
| AI summary / Fact extraction / Article generation / Quality check | **Designed** (schema + `AIProvider` interface exist; pipeline stage implementations are next, blocked on a live AI provider key) |
| Homepage, Car pages, Topic pages, Search | **Built, tested live + E2E-covered** (`apps/web`) — real seeded/ingested data, no fake content |
| English publication | **Built** — canonical is English at root. Spanish (`/es/`) editorial content is still **Designed only**: hreflang/canonical URLs are already emitted for it (`packages/seo`), but no `/es/` pages exist yet since that needs a real editorial process, not just a route |
| Article page | **Designed** (schema supports it; no `Article` rows exist yet — blocked on the AI writing pipeline above) |
| Admin | **Built, tested live + E2E-covered** — login, dashboard (real sources), stories queue, alerts, all real session-checked pages in `apps/web` |

## Roadmap (spec §81-84)

1. **Phase 1 (this vertical slice)**: ingestion → dedup → clustering →
   (stubbed-out) AI summary → publish → homepage/article page → minimal
   admin. Prove the pipe end to end with the simplest possible version of
   each stage before adding sophistication to any one of them.
2. **Phase 2**: multi-source clustering, fact conflicts, research engine,
   source reliability learning, image pipeline + rights engine, automotive
   entities populated for real, car pages, internal linking.
3. **Phase 3**: advanced SEO (hreflang/sitemap/structured data at scale),
   analytics, moderation, AI cost control dashboards, agent permissions
   enforced end-to-end, autonomous job scheduling, source health monitoring,
   stale-content detection.
4. **Phase 4**: the AI Editorial Agent itself — autonomous research,
   autonomous updates, SEO agent, moderation agent, content-quality agent,
   operational agent — gated behind the `AUTO_*` flags and the autonomy-level
   policy in docs/ai-pipeline.md, starting in **AI ASSISTED** mode, moving to
   **AI SUPERVISED**, and only to **AI AUTONOMOUS** once the earlier modes
   have produced enough track record to trust (spec §103) — this ordering
   is not optional or something to shortcut once the code exists.
