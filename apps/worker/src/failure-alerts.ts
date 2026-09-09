import type { Job } from "bullmq";
import { prisma } from "@automotive/database";

// Real gap found and fixed 2026-09-07 (same day retries were configured
// — checking a new feature's *consequences*, not just that it runs):
// once jobs could genuinely exhaust all retry attempts, a permanently-
// failed job had nowhere to surface but a console line nobody's
// watching. docs/security.md's Observability section names
// `SystemAlert` as exactly the channel for this ("crawler failures ...
// need a human's attention") — `ingestSource()` already uses it for the
// *expected* case (a feed being unreachable, which never throws, so this
// never sees it); this covers the *unexpected* case (an uncaught crash —
// e.g. a DB connection drop mid-run — that survives all real retries).
// CRITICAL, not WARNING: unlike a routine unreachable feed, this means
// retrying automatically already failed to recover.
export async function handleJobFailure(job: Job<{ sourceId: string }> | undefined, err: Error): Promise<void> {
  console.error(`[worker] job ${job?.id} (source ${job?.data.sourceId}) failed:`, err);

  const exhaustedRetries = job && job.attemptsMade >= (job.opts.attempts ?? 1);
  if (exhaustedRetries) {
    const message = `Ingestion job for source ${job.data.sourceId} failed permanently after ${job.attemptsMade} attempts: ${err.message}`;

    // Real gap found and fixed 2026-09-08: unlike ingestSource()'s own
    // WARNING-alert path (which compares against Source.lastError and
    // skips creating a duplicate for the same recurring failure), this
    // CRITICAL path had no dedup at all — a permanently-broken source
    // exhausts its retries on every single scheduled run (as often as
    // every real crawlInterval, 900s minimum), so it would raise a new
    // CRITICAL SystemAlert forever, flooding /admin/alerts with
    // duplicates of the exact same failure. Mirrors the same "same
    // message = same known failure, don't re-alert" semantic
    // ingestSource() already established, just via a query here instead
    // of a persisted field (this function has no Source row of its own
    // to update) — deliberately does not consider `resolved` (neither
    // does the pattern it mirrors): a resolved alert for this identical
    // message would otherwise let the exact same permanent failure spam
    // again right after someone acknowledges it.
    const alreadyAlerted = await prisma.systemAlert.findFirst({
      where: { source: "worker", severity: "CRITICAL", message },
      orderBy: { createdAt: "desc" },
    });
    if (alreadyAlerted) return;

    await prisma.systemAlert.create({
      data: {
        severity: "CRITICAL",
        source: "worker",
        message,
        metadata: { sourceId: job.data.sourceId, jobId: job.id, attemptsMade: job.attemptsMade },
      },
    });
  }
}
