import { afterEach, describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import { prisma } from "@automotive/database";
import { handleJobFailure } from "../failure-alerts.js";

// Real integration test against the real local Postgres — only the
// BullMQ `Job` object is faked (a plain object matching the few fields
// handleJobFailure actually reads), since constructing a real one needs
// a real Queue/Redis round trip this test doesn't otherwise need.

function fakeJob(overrides: Partial<{ id: string; sourceId: string; attemptsMade: number; attempts: number }> = {}) {
  const { id = "42", sourceId = "zzqxfixture-source", attemptsMade = 3, attempts = 3 } = overrides;
  return {
    id,
    data: { sourceId },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<{ sourceId: string }>;
}

describe("handleJobFailure", () => {
  afterEach(async () => {
    await prisma.systemAlert.deleteMany({ where: { source: "worker", message: { contains: "zzqxfixture" } } });
  });

  it("creates a real CRITICAL SystemAlert once retries are exhausted", async () => {
    const job = fakeJob({ attemptsMade: 3, attempts: 3 });
    await handleJobFailure(job, new Error("zzqxfixture simulated crash"));

    const alert = await prisma.systemAlert.findFirst({ where: { source: "worker" }, orderBy: { createdAt: "desc" } });
    expect(alert).toMatchObject({
      severity: "CRITICAL",
      message: expect.stringContaining("zzqxfixture simulated crash"),
    });
    expect(alert?.metadata).toMatchObject({ sourceId: "zzqxfixture-source", attemptsMade: 3 });
  });

  it("does NOT create a SystemAlert while retries remain (this attempt isn't the last one)", async () => {
    const before = await prisma.systemAlert.count({ where: { source: "worker" } });
    const job = fakeJob({ attemptsMade: 1, attempts: 3 });
    await handleJobFailure(job, new Error("zzqxfixture transient failure"));

    const after = await prisma.systemAlert.count({ where: { source: "worker" } });
    expect(after).toBe(before);
  });

  it("does nothing (no throw) when job is undefined — a real edge case BullMQ's types allow", async () => {
    await handleJobFailure(undefined, new Error("zzqxfixture")); // would reject/throw here if this regressed
  });

  it("does not create a duplicate CRITICAL alert for the same recurring permanent failure — the real fix for a gap where a permanently-broken source would re-alert on every scheduled run forever, unlike ingestSource()'s own WARNING-alert path which already dedupes", async () => {
    const job = fakeJob({ id: "42", sourceId: "zzqxfixture-source", attemptsMade: 3, attempts: 3 });
    await handleJobFailure(job, new Error("zzqxfixture recurring crash"));
    const countAfterFirst = await prisma.systemAlert.count({
      where: { source: "worker", message: { contains: "zzqxfixture recurring crash" } },
    });
    expect(countAfterFirst).toBe(1);

    // Same source, same underlying error, a later job run (different id) —
    // must NOT create a second alert for the identical known failure.
    const laterJob = fakeJob({ id: "43", sourceId: "zzqxfixture-source", attemptsMade: 3, attempts: 3 });
    await handleJobFailure(laterJob, new Error("zzqxfixture recurring crash"));
    const countAfterSecond = await prisma.systemAlert.count({
      where: { source: "worker", message: { contains: "zzqxfixture recurring crash" } },
    });
    expect(countAfterSecond).toBe(1);

    // A genuinely different failure for the same source must still alert.
    const differentFailureJob = fakeJob({ id: "44", sourceId: "zzqxfixture-source", attemptsMade: 3, attempts: 3 });
    await handleJobFailure(differentFailureJob, new Error("zzqxfixture a different crash"));
    const differentCount = await prisma.systemAlert.count({
      where: { source: "worker", message: { contains: "zzqxfixture a different crash" } },
    });
    expect(differentCount).toBe(1);
  });
});
