#!/usr/bin/env bash
set -euo pipefail

# Real production deploy script. Added 2026-09-09, the first time the
# production host (/opt/automotive-ai-platform on the real VPS) was ever
# wired onto real git history — before this, the server's copy had no
# .git at all and was updated by direct file copy (rsync/scp), completely
# disconnected from this repo's own commits. See docs/deployment.md's
# "CI/CD" section for the full story, including why the two were
# disconnected in the first place.
#
# Run this ON the production host, from the repo root:
#   cd /opt/automotive-ai-platform && infrastructure/scripts/deploy.sh
#
# Public repo, so `git fetch`/`merge` below need no credentials — verified
# live 2026-09-09 (no GitHub token exists on this host at all).
#
# Written and reasoned through by hand, matching this project's own
# established honesty convention (see docs/deployment.md's Dockerfiles/
# CI notes) — the fetch+merge step has been run for real (used to bring
# the server from commit 0a7e546 to b432f3c, verified live: container
# uptime unaffected, site stayed 200 throughout, confirmed via
# `git rev-parse HEAD` matching origin/main after). The build/up/network
# steps below encode the exact real gotchas this project's own README
# already found and documented the hard way (see its "Docker Compose /
# Dockerfiles / Nginx" row) but have not yet been run end-to-end via this
# exact script — there was no real code change needing a live rebuild
# yet when this was written. Verify with a real, low-stakes change before
# trusting it unattended.

cd "$(dirname "$0")/../.."
# Real gap found and fixed on this script's own first real end-to-end run
# (2026-09-09): docker compose's automatic .env discovery did not
# reliably pick up this directory's real .env when invoked this way (a
# real `prisma migrate deploy` run failed with "STORAGE_SECRET_ACCESS_KEY
# is missing a value" etc. even though every one of those vars is
# genuinely present in .env, confirmed by listing its real key names) —
# passing --env-file explicitly fixed it, verified live immediately
# after. Better to be explicit and correct than rely on discovery that's
# already demonstrated to be unreliable in this exact context.
COMPOSE_FILES=(--env-file .env -f infrastructure/docker/docker-compose.yml -f infrastructure/docker/docker-compose.override.yml)

echo "==> Fetching latest from origin/main"
git fetch origin

echo "==> Fast-forwarding working tree (refuses and stops if history diverged locally — never force; investigate by hand instead)"
git merge --ff-only origin/main

echo "==> Rebuilding the 3 app images from the updated source (a bare 'exec' would run the STALE code baked into the last image — see README's own 'Docker Compose' row for how this was found live)"
docker compose "${COMPOSE_FILES[@]}" build api worker web

# Real bug found live 2026-09-15, first deploy that actually bundled a
# schema migration with other code changes: this step used to run
# BEFORE the build step above, via `docker compose run --rm api ...` —
# since the Dockerfile COPIES the repo into the image at build time
# (no bind mount), that `run` used the OLD, not-yet-rebuilt api image,
# whose baked-in prisma/migrations/ directory didn't have the new
# migration file yet. It reported "No pending migrations to apply" and
# silently did nothing; the new column had to be applied by hand,
# after the fact, once the image really did exist. Migrate must run
# AFTER build (still before `up -d --force-recreate` below, so the old
# containers are never left running against a newer schema mid-swap).
echo "==> Applying any pending migrations (prisma migrate deploy — never migrate dev, never db:seed, against this real DATABASE_URL)"
docker compose "${COMPOSE_FILES[@]}" run --rm api npx prisma migrate deploy --schema packages/database/prisma/schema.prisma

echo "==> Recreating the 3 app containers with the new images"
docker compose "${COMPOSE_FILES[@]}" up -d --force-recreate api worker web

echo "==> Confirming 'web' is still on the shared webproxy network (docker-compose.override.yml declares this network for 'web' now — it SHOULD survive --force-recreate when both compose files are passed together, unlike the manual 'docker network connect' this project needed before that override existed; verifying rather than assuming, since this exact path has not been run end-to-end yet)"
if ! docker inspect automotive-ai-platform-web-1 --format '{{json .NetworkSettings.Networks}}' | grep -q webproxy; then
  echo "    webproxy NOT attached automatically — reconnecting by hand (the pre-override fallback)"
  docker network connect webproxy automotive-ai-platform-web-1
fi

echo "==> Done. Verify the real site: curl -sI https://autonewsfeed.com | head -1"
