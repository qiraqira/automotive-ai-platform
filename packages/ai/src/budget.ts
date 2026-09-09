import { prisma } from "@automotive/database";

// Central budget guard — every provider call must go through this before
// spending money, so the limit is enforced once here, not re-implemented
// (or forgotten) at each call site. See docs/ai-pipeline.md "Budget control".

export interface BudgetLimits {
  dailyUsd: number;
  monthlyUsd: number;
  perTaskUsd: number;
}

export class BudgetExceededError extends Error {
  constructor(public readonly scope: "daily" | "monthly" | "per_task", public readonly spentUsd: number, public readonly limitUsd: number) {
    super(`AI budget exceeded (${scope}): spent $${spentUsd.toFixed(2)} of $${limitUsd.toFixed(2)}`);
  }
}

function startOfDayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfMonthUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Throws BudgetExceededError if spending `estimatedCostUsd` more would
 * cross any configured limit. Call this BEFORE making the provider call,
 * with a conservative cost estimate — the real cost gets recorded
 * afterwards via recordExecution() below regardless of the estimate's
 * accuracy. */
export async function assertWithinBudget(estimatedCostUsd: number, limits: BudgetLimits): Promise<void> {
  if (estimatedCostUsd > limits.perTaskUsd) {
    throw new BudgetExceededError("per_task", estimatedCostUsd, limits.perTaskUsd);
  }

  const [dailySpent, monthlySpent] = await Promise.all([
    prisma.aIExecution.aggregate({
      _sum: { estimatedCostUsd: true },
      where: { createdAt: { gte: startOfDayUtc() } },
    }),
    prisma.aIExecution.aggregate({
      _sum: { estimatedCostUsd: true },
      where: { createdAt: { gte: startOfMonthUtc() } },
    }),
  ]);

  // Real gap found and fixed 2026-09-08: this line is a single plain JS
  // `+` between whatever Postgres's own SUM() returns and the new
  // estimatedCostUsd argument — verified live, and specifically checked
  // that Postgres's own float aggregation is NOT the source of the risk
  // (a real SUM() over two stored $0.1/$0.2 rows correctly returns a
  // clean `0.3`); the classic `0.1 + 0.2 !== 0.3` imprecision comes from
  // THIS function's own final addition once a real prior-spend total
  // and a real new estimate combine to exactly that pair of values.
  // First test attempt got this wrong — recorded both 0.1 and 0.2 as
  // prior spend and asserted with estimatedCostUsd: 0, which only
  // exercises Postgres's own (already-clean) SUM and would have passed
  // even without this fix; caught by deliberately reverting the fix and
  // confirming the test still passed, then fixing the test to record
  // only 0.1 as prior spend and pass 0.2 as the new estimatedCostUsd —
  // that combination reproduces the real bug (confirmed: reverting the
  // fix again made the corrected test fail with `spentUsd:
  // 0.30000000000000004`). Rounding to cent precision at the comparison
  // point (not touching how anything is stored) eliminates the sub-cent
  // floating-point noise without needing a bigger integer-cents schema
  // migration for a feature nothing calls yet (`packages/ai` has no
  // live provider wired in — see README).
  const roundToCents = (n: number): number => Math.round(n * 100) / 100;
  const dailyTotal = roundToCents((dailySpent._sum.estimatedCostUsd ?? 0) + estimatedCostUsd);
  const monthlyTotal = roundToCents((monthlySpent._sum.estimatedCostUsd ?? 0) + estimatedCostUsd);

  if (dailyTotal > limits.dailyUsd) {
    throw new BudgetExceededError("daily", dailyTotal, limits.dailyUsd);
  }
  if (monthlyTotal > limits.monthlyUsd) {
    throw new BudgetExceededError("monthly", monthlyTotal, limits.monthlyUsd);
  }
}

export interface ExecutionRecord {
  jobId: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
  latencyMs: number;
  success: boolean;
  errorMessage?: string;
  promptTemplateId?: string;
  promptVersion?: number;
}

// Real gap found and fixed 2026-09-08: docs/ai-pipeline.md's own "Budget
// control" section documents this as part of the same real contract as
// assertWithinBudget() above ("Every AIExecution row records
// tokensIn/tokensOut/estimatedCostUsd") — and assertWithinBudget()'s own
// doc comment already described calling this "afterwards", as if it
// existed — but no real recordExecution() was ever implemented anywhere
// in this package. The only thing with this name was a same-named
// private helper inside budget.test.ts, written purely to create
// fixture rows for exercising assertWithinBudget()'s aggregation query —
// it was never exported, never called from real pipeline code, and
// would have been invisible to any future stage author reading this
// file's own public API. Not fixable by "just wiring up the AI
// provider" (that's the real, externally-blocked gap, needing a real
// API key) — this is pure bookkeeping plumbing every future stage needs
// regardless of which provider ends up used, exactly the same
// "centralize once here, don't let each call site reinvent it" reasoning
// already applied to the budget guard itself.
export async function recordExecution(record: ExecutionRecord): Promise<void> {
  await prisma.aIExecution.create({ data: { ...record } });
}

// Real gap found and fixed 2026-09-08, same shape as recordExecution()
// above: docs/ai-pipeline.md's "Budget control" section documents
// assertWithinBudget()'s failure mode as "the job is left PENDING (not
// failed — it resumes once budget resets) and a SystemAlert (WARNING) is
// raised" — but nothing in this package ever turned a thrown
// BudgetExceededError into either of those two real effects. A future
// pipeline stage catching the error and doing this ad hoc per call site
// would silently drift (which fields on SystemAlert, which AIJobStatus)
// the same way recordExecution() would have if left unimplemented — so
// centralized here once, like every other piece of budget bookkeeping in
// this file. Not blocked on a live AI provider: this is pure job/alert
// orchestration around the guard that already exists and is already
// tested against the real local DB.
export async function handleBudgetExceeded(jobId: string, error: BudgetExceededError): Promise<void> {
  await prisma.$transaction([
    prisma.aIJob.update({ where: { id: jobId }, data: { status: "PENDING" } }),
    prisma.systemAlert.create({
      data: {
        severity: "WARNING",
        source: "ai",
        message: error.message,
        metadata: { jobId, scope: error.scope, spentUsd: error.spentUsd, limitUsd: error.limitUsd },
      },
    }),
  ]);
}
