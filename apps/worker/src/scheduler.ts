import type { Queue } from "bullmq";
import { prisma } from "@automotive/database";

// Real gap found and fixed 2026-09-07 (same day this scheduler was
// migrated to BullMQ from a plain setInterval loop): the admin
// dashboard's real "Sources" management (PATCH /v1/sources/:id) can
// deactivate a source or change its crawlInterval — a running scheduler
// needs to notice. Called on a poll (not instant, but this is a
// background scheduler, not a user-facing action): removes the BullMQ
// Job Scheduler for any source that's no longer active, and
// `upsertJobScheduler` for every active one (safe to call repeatedly —
// it's a real upsert, not just a create, so a changed crawlInterval
// takes effect on the next reconcile without any manual diffing).
// `ingestSource()` itself also checks `active` (see ingest.ts) for the
// case where an already-queued job fires inside a poll window.
export async function reconcile(queue: Queue): Promise<void> {
  const sources = await prisma.source.findMany({ where: { active: true } });
  const activeIds = new Set(sources.map((s) => s.id));

  // Real bug found and fixed 2026-09-07, same day this was written: the
  // objects `getJobSchedulers()` actually returns key the scheduler by
  // `.key` (confirmed by directly inspecting a live call's real output),
  // not `.id` — `.id` is present in BullMQ's TS type but was `undefined`
  // on every real object here. Using `.id` meant the removal branch below
  // silently never ran for *any* scheduler — a deactivated source's
  // schedule would live forever. Caught by deactivating a real source
  // live and checking BullMQ's actual Redis-backed state directly rather
  // than trusting the "it didn't log an error" absence of feedback.
  const schedulers = await queue.getJobSchedulers();
  const existingSchedulerKeys = new Set(schedulers.map((s) => s.key));

  for (const scheduler of schedulers) {
    if (!activeIds.has(scheduler.key)) {
      await queue.removeJobScheduler(scheduler.key);
      console.log(`[worker] removed scheduler for now-inactive/removed source ${scheduler.key}`);
    }
  }

  for (const source of sources) {
    const isNewlyScheduled = !existingSchedulerKeys.has(source.id);
    // `upsertJobScheduler` itself creates and runs a first job right away
    // for a brand-new scheduler (confirmed live: a fresh scheduler
    // ingests immediately with no extra `queue.add()` needed — the docs'
    // "delayed accordingly" phrasing refers to *subsequent* occurrences,
    // not the first one). An earlier version of this file also called
    // `queue.add()` manually to force an immediate run, which actually
    // caused every source to ingest twice on startup — real duplicate
    // ingestion, caught by testing this live rather than trusting the
    // docstring's wording alone.
    await queue.upsertJobScheduler(
      source.id,
      { every: source.crawlInterval * 1000 },
      {
        name: "ingest",
        data: { sourceId: source.id },
        // Real gap found and fixed 2026-09-07, same day as the BullMQ
        // migration itself: this was originally added with no `attempts`/
        // `backoff` at all — BullMQ's own defaults are `attempts: 1`
        // (i.e. no retry) and `concurrency: 1` on the Worker, so the
        // README's "real retries, concurrency control" claim was false
        // as actually configured, caught by checking the real code
        // against the real claim rather than assuming the migration
        // itself implied these were on. `ingestSource()` already catches
        // and reports expected failures (a feed being unreachable) as
        // data in its return value, not by throwing — so this genuinely
        // only matters for the rarer case of an unexpected crash (e.g. a
        // DB connection drop mid-run), which is exactly what it's for.
        opts: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
      },
    );
    if (isNewlyScheduled) {
      console.log(`[worker] scheduled source ${source.id} every ${source.crawlInterval}s`);
    }
  }
}
