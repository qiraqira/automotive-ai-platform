import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@automotive/database";
import { assertWithinBudget, BudgetExceededError, handleBudgetExceeded, recordExecution as realRecordExecution } from "../budget.js";

// Real integration tests against the actual local DB (same pattern as
// apps/api's tests) — assertWithinBudget's whole job is aggregating real
// AIExecution rows, so mocking the DB would test nothing meaningful.

let jobId: string;
const createdExecutionIds: string[] = [];

beforeEach(async () => {
  const job = await prisma.aIJob.create({
    data: { type: "WRITE_ARTICLE", input: { test: true } },
  });
  jobId = job.id;
});

afterEach(async () => {
  // Keep the shared local DB repeatable across runs/ticks, same discipline
  // as the api/ranking integration tests.
  await prisma.aIExecution.deleteMany({ where: { id: { in: createdExecutionIds } } });
  createdExecutionIds.length = 0;
  await prisma.aIJob.delete({ where: { id: jobId } });
});

// Delegates to the real, now-implemented recordExecution() (see budget.ts)
// rather than writing the fixture row directly — exercises the actual
// production function these tests' own aggregation checks depend on, not
// just a same-shaped stand-in.
async function recordExecution(costUsd: number) {
  await realRecordExecution({
    jobId,
    provider: "test",
    model: "test-model",
    tokensIn: 0,
    tokensOut: 0,
    estimatedCostUsd: costUsd,
    latencyMs: 0,
    success: true,
  });
  const [execution] = await prisma.aIExecution.findMany({ where: { jobId }, orderBy: { createdAt: "desc" }, take: 1 });
  createdExecutionIds.push(execution.id);
}

const GENEROUS_LIMITS = { dailyUsd: 1000, monthlyUsd: 10000, perTaskUsd: 1000 };

describe("assertWithinBudget", () => {
  it("allows a call comfortably within all limits", async () => {
    await expect(assertWithinBudget(0.01, GENEROUS_LIMITS)).resolves.toBeUndefined();
  });

  it("rejects a single call that exceeds perTaskUsd on its own, regardless of prior spend", async () => {
    await expect(assertWithinBudget(5, { dailyUsd: 1000, monthlyUsd: 10000, perTaskUsd: 1 })).rejects.toThrow(BudgetExceededError);
  });

  it("rejects when today's real recorded spend plus this call would exceed dailyUsd", async () => {
    await recordExecution(8);
    await expect(assertWithinBudget(5, { dailyUsd: 10, monthlyUsd: 10000, perTaskUsd: 1000 })).rejects.toMatchObject({
      scope: "daily",
    });
  });

  it("allows the call when today's real recorded spend plus this call stays within dailyUsd", async () => {
    await recordExecution(2);
    await expect(assertWithinBudget(2, { dailyUsd: 10, monthlyUsd: 10000, perTaskUsd: 1000 })).resolves.toBeUndefined();
  });

  it("rejects when monthly spend would be exceeded even though daily is fine", async () => {
    await recordExecution(3);
    await expect(
      assertWithinBudget(3, { dailyUsd: 1000 /* daily is generous */, monthlyUsd: 5, perTaskUsd: 1000 }),
    ).rejects.toMatchObject({ scope: "monthly" });
  });

  // Real gap found and fixed 2026-09-08: summing real, arbitrary-decimal
  // USD costs as plain JS floats hits the classic `0.1 + 0.2 !== 0.3`
  // imprecision for real. Verified live, and specifically where it
  // actually bites in this function: Postgres's own `SUM()` aggregate
  // returns a clean `0.1` for a single recorded $0.1 execution (checked
  // directly — Postgres's float aggregation does NOT reproduce the
  // classic JS imprecision on its own), but the function's own
  // `dbSum + estimatedCostUsd` is a single plain JS `+` — and `0.1 +
  // 0.2` is exactly the classic case (`0.30000000000000004`, not
  // `0.3`). An earlier version of this test recorded BOTH `0.1` and
  // `0.2` as prior spend and asserted with `estimatedCostUsd: 0` —
  // wrong: that only exercises Postgres's own (already-clean) SUM, not
  // this function's real, vulnerable `+`. Confirmed by deliberately
  // reverting the fix and re-running: the wrong version of this test
  // still passed even without the fix, while this corrected version
  // fails as expected without it.
  it("allows a call when today's real recorded spend plus this call is mathematically exactly at dailyUsd, despite floating-point summation noise", async () => {
    await recordExecution(0.1);
    // 0.1 (real prior spend, from Postgres) + 0.2 (this call's own
    // estimatedCostUsd) = 0.3 mathematically; plain JS `+` gives
    // 0.30000000000000004 — confirmed live before writing this test.
    await expect(assertWithinBudget(0.2, { dailyUsd: 0.3, monthlyUsd: 10000, perTaskUsd: 1000 })).resolves.toBeUndefined();
  });
});

describe("handleBudgetExceeded", () => {
  it("leaves the real job PENDING (not FAILED) and raises a real WARNING SystemAlert", async () => {
    await prisma.aIJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });
    const error = new BudgetExceededError("daily", 12.34, 10);

    await handleBudgetExceeded(jobId, error);

    const job = await prisma.aIJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("PENDING");

    const [alert] = await prisma.systemAlert.findMany({
      where: { source: "ai", metadata: { path: ["jobId"], equals: jobId } },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(alert).toMatchObject({
      severity: "WARNING",
      source: "ai",
      message: error.message,
      metadata: { jobId, scope: "daily", spentUsd: 12.34, limitUsd: 10 },
    });

    await prisma.systemAlert.delete({ where: { id: alert.id } });
  });
});

describe("recordExecution", () => {
  it("writes a real AIExecution row with every field, including the optional prompt-versioning ones", async () => {
    // A real PromptTemplate fixture — promptTemplateId is a real foreign
    // key (references PromptTemplate.id, not its `key`), so a made-up
    // string here would fail exactly the way a bad marketId did on
    // apps/api's Fact-creation endpoint (see that fix's own memory entry).
    const promptTemplate = await prisma.promptTemplate.create({ data: { key: `zzqxfixture_${jobId}` } });
    try {
      await realRecordExecution({
        jobId,
        provider: "anthropic",
        model: "claude-test",
        tokensIn: 120,
        tokensOut: 340,
        estimatedCostUsd: 0.05,
        latencyMs: 842,
        success: true,
        promptTemplateId: promptTemplate.id,
        promptVersion: 3,
      });

      const [execution] = await prisma.aIExecution.findMany({ where: { jobId } });
      expect(execution).toMatchObject({
        jobId,
        provider: "anthropic",
        model: "claude-test",
        tokensIn: 120,
        tokensOut: 340,
        estimatedCostUsd: 0.05,
        latencyMs: 842,
        success: true,
        promptTemplateId: promptTemplate.id,
        promptVersion: 3,
        errorMessage: null,
      });
      // Deleted here (child before parent), not via afterEach's
      // createdExecutionIds — that cleanup runs after this finally block,
      // which would otherwise try to delete promptTemplate while this row
      // still references it (no onDelete: Cascade on this relation).
      await prisma.aIExecution.delete({ where: { id: execution.id } });
    } finally {
      await prisma.promptTemplate.delete({ where: { id: promptTemplate.id } });
    }
  });

  it("records a real failed execution with its error message, omitting the optional prompt-versioning fields", async () => {
    await realRecordExecution({
      jobId,
      provider: "anthropic",
      model: "claude-test",
      tokensIn: 50,
      tokensOut: 0,
      estimatedCostUsd: 0.01,
      latencyMs: 200,
      success: false,
      errorMessage: "rate_limited",
    });

    const [execution] = await prisma.aIExecution.findMany({ where: { jobId } });
    createdExecutionIds.push(execution.id);
    expect(execution).toMatchObject({ success: false, errorMessage: "rate_limited", promptTemplateId: null, promptVersion: null });
  });

  it("a recorded execution is immediately reflected in assertWithinBudget's own aggregation", async () => {
    await realRecordExecution({
      jobId,
      provider: "test",
      model: "test-model",
      tokensIn: 0,
      tokensOut: 0,
      estimatedCostUsd: 7,
      latencyMs: 0,
      success: true,
    });
    const [execution] = await prisma.aIExecution.findMany({ where: { jobId } });
    createdExecutionIds.push(execution.id);

    await expect(assertWithinBudget(5, { dailyUsd: 10, monthlyUsd: 10000, perTaskUsd: 1000 })).rejects.toMatchObject({
      scope: "daily",
    });
  });
});
