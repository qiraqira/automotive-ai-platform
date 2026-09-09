import { prisma } from "@automotive/database";
import { ingestSource } from "./ingest.js";

// One-shot CLI entrypoint (`npm run ingest:once --workspace apps/worker`) —
// useful for manual testing and re-running ingestion without booting the
// real scheduler. Stale comment found and fixed 2026-09-08: this used to
// describe apps/worker/src/index.ts as "currently a plain per-source
// setInterval loop... not yet BullMQ-backed" — that migration happened
// 2026-09-07 (see index.ts's own comment); index.ts is the real BullMQ-
// backed recurring entrypoint now. This script still exists for the same
// reason — proving the ingestion logic independently of the scheduler —
// just no longer describes index.ts's actual current architecture.

async function main() {
  const sources = await prisma.source.findMany({ where: { active: true } });
  console.log(`Ingesting ${sources.length} active source(s)...`);

  for (const source of sources) {
    const result = await ingestSource(source.id);
    console.log(`\n[${source.name}]`, JSON.stringify(result, null, 2));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
