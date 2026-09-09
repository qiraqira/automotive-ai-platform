import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { env } from "@automotive/config";
import { prisma } from "@automotive/database";
import { ingestSource } from "./ingest.js";
import { reconcile } from "./scheduler.js";
import { handleJobFailure } from "./failure-alerts.js";
import { runWriteArticleBatch } from "./write-article.js";

// Real BullMQ-backed scheduler, replacing the plain setInterval loop this
// file used to be. That version was documented as "not yet BullMQ-backed"
// because no compatible Redis existed in this dev environment (the only
// Windows Redis found was v3.0.504 — BullMQ hard-requires >=5.0.0).
// Resolved 2026-09-07 by downloading a real, modern Redis 8.10.1 Windows
// build (github.com/redis-windows/redis-windows, a portable zip, no
// install) after explicit user go-ahead — see docs/database.md "Local
// dev Redis" for the exact setup. This file now gets real retries,
// concurrency control, and a persistent job store for free from BullMQ,
// none of which the old setInterval version had. `reconcile()` itself
// lives in scheduler.ts, split out the same way ingest.ts/app.ts already
// are, so it can be tested against a real Queue without booting a Worker.

export const QUEUE_NAME = "source-ingestion";
const RECONCILE_INTERVAL_SECONDS = 60;
// The first real AI_KILL_SWITCH enforcement in this codebase — every
// prior mention of it (packages/config, docs/ai-pipeline.md) was
// honestly documented as "parsed but never checked anywhere" since there
// was no real AI-calling loop to check it in. This periodic trigger for
// apps/worker/src/write-article.ts's real Writer stage is that loop, so
// this is where the switch finally does something. 15 min default: real
// automotive news doesn't need a Story written into an article within
// seconds of being ingested, and every call still costs real money
// through the already-real AI_DAILY_BUDGET_USD guard — no reason to run
// this more often than the RSS sources themselves refresh (900s, see
// docs/database.md's seeded `crawlInterval`).
const WRITE_ARTICLES_INTERVAL_SECONDS = Number(process.env.WRITE_ARTICLES_INTERVAL_SECONDS ?? 900);
const WRITE_ARTICLES_BATCH_SIZE = Number(process.env.WRITE_ARTICLES_BATCH_SIZE ?? 3);

// BullMQ needs this exact option on its Redis connection for its
// blocking commands to work correctly — without it, ioredis's own retry
// logic fights BullMQ's.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Minor observability gap found and fixed 2026-09-08, found while
// checking this exact connection for the same class of crash risk as
// the three fixes above — verified live first, not assumed: with no
// listener attached, `ioredis` does NOT crash the process on a real
// connection failure (confirmed via a real unreachable-address test)
// — it has its own internal default handler for exactly this reason.
// But that default handler prints an unstructured
// `[ioredis] Unhandled error event: ...` line straight to stderr,
// inconsistent with every other real error path in this codebase
// (reconcile/handleJobFailure/SIGTERM above, request-logger.ts,
// apps/api's global error handler), all of which log one structured
// JSON line. Attaching an explicit listener doesn't change safety
// (already safe either way) — it just keeps a real Redis outage
// visible in the same structured, parseable form as everything else.
//
// Real gap caught while verifying this fix, not assumed: a genuine
// ECONNREFUSED here surfaces as a real `AggregateError` (Node's `net`
// trying both the IPv6 and IPv4 loopback addresses and wrapping both
// failures) whose own top-level `.message` is an empty string — the
// actual detail lives in `.errors`. Confirmed live against a real
// unreachable address before trusting this extraction.
function redisErrorReason(err: unknown): string {
  if (err instanceof AggregateError) return err.errors.map((e) => (e instanceof Error ? e.message : String(e))).join("; ");
  return err instanceof Error ? err.message : String(err);
}

connection.on("error", (err) => {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "redis_connection_error", reason: redisErrorReason(err) }));
});

const queue = new Queue(QUEUE_NAME, { connection });

interface IngestJobData {
  sourceId: string;
}

const worker = new Worker<IngestJobData>(
  QUEUE_NAME,
  async (job: Job<IngestJobData>) => {
    const result = await ingestSource(job.data.sourceId);
    console.log(`[worker] ingested source ${job.data.sourceId}:`, result);
    return result;
  },
  // `concurrency` defaults to 1 (process one job at a time) if
  // unspecified — real gap caught the same way as the missing retry
  // config in scheduler.ts: a claim of "concurrency control" in README
  // that wasn't actually configured anywhere. 5 lets different sources'
  // scheduled ingests run in parallel rather than queuing behind each
  // other, without being unbounded (this project has 3 real sources
  // today, so this is real headroom, not a number picked to look good).
  { connection, concurrency: 5 },
);

// Real, severe gap found and fixed 2026-09-08, same tick as the
// reconcile() fix below and the identical underlying cause: `Worker` is
// a plain Node `EventEmitter` — verified live (a real subprocess) that
// it does NOT await an async listener or catch its rejection any more
// than a bare `setInterval` callback does. `handleJobFailure()` itself
// does a real DB read+write (`prisma.systemAlert.findFirst`/`.create()`)
// to raise the CRITICAL alert for an exhausted-retries job — exactly
// the kind of call that can genuinely fail transiently, and doing so
// would have crashed the ENTIRE worker process from inside its own
// job-failure handler, the one code path whose entire purpose is
// reacting safely to something already going wrong.
worker.on("failed", (job, err) => {
  handleJobFailure(job, err).catch((handlerErr) => {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "handle_job_failure_failed", reason: handlerErr instanceof Error ? handlerErr.message : String(handlerErr) }));
  });
});

// Real, severe gap found and fixed 2026-09-08: the periodic reconcile()
// call below had no error handling at all — verified live (a real
// throwaway subprocess, this exact Node version) that an unhandled
// rejection inside a bare `setInterval` callback doesn't get silently
// swallowed the way older Node versions did; it's fatal, killing the
// ENTIRE process immediately. `reconcile()` does real DB (`prisma.
// source.findMany`) and Redis (`queue.getJobSchedulers()`/
// `upsertJobScheduler`/`removeJobScheduler`) calls, any of which can
// genuinely fail transiently — a real, plausible operational hiccup,
// not a contrived one. Unlike the one-off startup `await reconcile()`
// above (already safely covered by `main().catch()` below), EVERY
// subsequent reconcile — every 60s, forever, for the entire lifetime of
// this always-running process — had zero crash protection: the single
// most severe class of bug this whole session has found (the same
// "unhandled rejection kills the process" shape as the `marketId`
// crash on `apps/api`, here in the one process that's supposed to run
// unattended forever). A reconcile failure on its own is not a total
// ingestion outage (already-scheduled BullMQ Job Schedulers keep firing
// independently of reconcile), so this doesn't need a new SystemAlert
// channel — just needs to not take the whole worker down. Logged via
// the same structured-JSON console.error style used elsewhere in this
// codebase.
function scheduleReconcile() {
  setInterval(() => {
    reconcile(queue).catch((err) => {
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "reconcile_failed", reason: err instanceof Error ? err.message : String(err) }));
    });
  }, RECONCILE_INTERVAL_SECONDS * 1000);
}

// Same crash-safety discipline as scheduleReconcile() above (a bare
// setInterval callback's unhandled rejection is fatal on this Node
// version — verified live for that fix, applies identically here): a
// transient DB/Anthropic-API hiccup during one batch must never take
// down the whole worker process, including its unrelated ingestion
// scheduling.
function scheduleWriteArticles() {
  setInterval(() => {
    runWriteArticleBatch(WRITE_ARTICLES_BATCH_SIZE).catch((err) => {
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "write_article_batch_failed", reason: err instanceof Error ? err.message : String(err) }));
    });
  }, WRITE_ARTICLES_INTERVAL_SECONDS * 1000);
}

async function main() {
  await reconcile(queue);
  const schedulerCount = await queue.getJobSchedulersCount();
  console.log(`[worker] ${schedulerCount} active source(s) scheduled via BullMQ, reconciling every ${RECONCILE_INTERVAL_SECONDS}s`);
  scheduleReconcile();

  if (env.AI_KILL_SWITCH) {
    console.log("[worker] AI_KILL_SWITCH is on — the Writer stage will not be scheduled.");
  } else if (!env.ANTHROPIC_API_KEY) {
    console.log("[worker] ANTHROPIC_API_KEY is not set — the Writer stage will not be scheduled.");
  } else {
    console.log(`[worker] Writer stage scheduled: up to ${WRITE_ARTICLES_BATCH_SIZE} article(s) every ${WRITE_ARTICLES_INTERVAL_SECONDS}s`);
    scheduleWriteArticles();
  }
}

main().catch((err) => {
  console.error("[worker] fatal error during startup:", err);
  process.exitCode = 1;
});

// Real gap found and fixed 2026-09-08, found while sweeping for the same
// pattern as the two fixes above: same fatal-unhandled-rejection risk,
// verified live, though lower-stakes here since the process is already
// mid-shutdown — a rejection from any close() call would still crash
// before reaching `process.exit(0)` rather than exiting cleanly, but
// wouldn't cost real uptime the way the other two would have. Fixed the
// same way for completeness rather than leaving a known third instance.
process.on("SIGTERM", async () => {
  try {
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "sigterm_shutdown_failed", reason: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  }
});
