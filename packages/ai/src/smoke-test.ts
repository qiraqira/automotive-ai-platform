import { prisma } from "@automotive/database";
import { env, budgetLimits } from "@automotive/config";
import { assertWithinBudget, recordExecution, handleBudgetExceeded, BudgetExceededError } from "./budget.js";
import { createTextProvider } from "./create-provider.js";
import { DEFAULT_ANTHROPIC_MODEL } from "./providers/anthropic-provider.js";

// Manual, one-off verification script — NOT part of the automated test
// suite (spends real money on a real, tiny Anthropic call). Run this once
// after setting ANTHROPIC_API_KEY to prove the whole real chain a future
// pipeline stage will use — assertWithinBudget() -> provider.complete() ->
// recordExecution() — actually works end to end against the real API and
// the real local DB, same "verify live, don't just trust the code
// compiles" discipline as every other script in this project (seed.ts,
// bootstrap.ts, create-admin.ts). Reuses AIJobType.CLUSTER_STORY since the
// schema has no dedicated smoke-test job type and adding one just for this
// would be its own migration for a one-off script; cleans the row up after.
async function main() {
  if (!env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set in the environment — nothing to test. Set it in .env first.");
    process.exit(1);
  }

  const provider = createTextProvider();
  if (provider.name !== "anthropic") {
    console.error(`createTextProvider() returned provider "${provider.name}", not "anthropic" — check AI_DEFAULT_TEXT_PROVIDER in .env.`);
    process.exit(1);
  }

  const job = await prisma.aIJob.create({ data: { type: "CLUSTER_STORY", input: { smokeTest: true } } });
  console.log(`Created AIJob ${job.id} (type CLUSTER_STORY, reused for this smoke test).`);

  // Conservative pre-call estimate for a ~16-token Haiku reply — real cost
  // gets recorded from the actual response usage below regardless.
  const estimatedCostUsd = 0.001;
  try {
    await assertWithinBudget(estimatedCostUsd, budgetLimits);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      await handleBudgetExceeded(job.id, err);
      console.error(`Budget guard blocked this call before any spend: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const start = Date.now();
  try {
    const result = await provider.complete({ prompt: "Reply with exactly one word: pong", maxTokens: 16 });
    const latencyMs = Date.now() - start;

    // Haiku 4.5 pricing at time of writing: $1/$5 per 1M input/output tokens.
    const realCostUsd = (result.tokensIn / 1_000_000) * 1 + (result.tokensOut / 1_000_000) * 5;

    await recordExecution({
      jobId: job.id,
      provider: provider.name,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      estimatedCostUsd: realCostUsd,
      latencyMs,
      success: true,
    });

    console.log(`Model ${result.model} replied: "${result.text.trim()}"`);
    console.log(`tokensIn=${result.tokensIn} tokensOut=${result.tokensOut} latencyMs=${latencyMs} cost=$${realCostUsd.toFixed(6)}`);
    console.log("Recorded a real AIExecution row. Smoke test passed end to end.");
  } catch (err) {
    const latencyMs = Date.now() - start;
    await recordExecution({
      jobId: job.id,
      provider: provider.name,
      model: DEFAULT_ANTHROPIC_MODEL,
      tokensIn: 0,
      tokensOut: 0,
      estimatedCostUsd: 0,
      latencyMs,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    console.error("Provider call failed — recorded the failed AIExecution row, re-throwing:", err);
    process.exitCode = 1;
  } finally {
    // AIExecution.jobId is onDelete: Cascade (schema.prisma) — deleting
    // the AIJob alone also removes the AIExecution row(s) recorded above.
    await prisma.aIJob.delete({ where: { id: job.id } }).catch(() => {});
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
