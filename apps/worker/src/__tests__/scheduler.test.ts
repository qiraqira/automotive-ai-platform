import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@automotive/database";
import { reconcile } from "../scheduler.js";

// Real integration test against the actual local Redis (see
// docs/database.md "Local dev Redis") and Postgres — same convention as
// apps/worker's other tests. Uses a dedicated queue name so this never
// collides with the real "source-ingestion" queue a running worker might
// have live schedulers in.

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6390";
const QUEUE_NAME = "scheduler-test-queue";

describe("reconcile", () => {
  let connection: Redis;
  let queue: Queue;
  let sourceId: string;

  beforeEach(async () => {
    connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue(QUEUE_NAME, { connection });
    await queue.obliterate({ force: true }).catch(() => {});

    const source = await prisma.source.create({
      data: {
        name: "Zzqxfixture Scheduler Test Source",
        url: "https://test.invalid/zzqxfixture-scheduler",
        feedUrl: "https://test.invalid/zzqxfixture-scheduler/feed.xml",
        country: "US",
        language: "en",
        type: "NEWS_MEDIA",
        tier: "SPECIALIST",
        trustScore: 50,
        active: true,
        crawlInterval: 900,
      },
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    await prisma.source.delete({ where: { id: sourceId } }).catch(() => {});
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
    await connection.quit();
  });

  it("creates a real BullMQ job scheduler for an active source", async () => {
    await reconcile(queue);

    const schedulers = await queue.getJobSchedulers();
    const mine = schedulers.find((s) => s.key === sourceId);
    expect(mine).toBeDefined();
    expect(mine?.every).toBe(900_000);
  });

  it("configures real retry/backoff on the job template — locks in the self-caught 'attempts were never set' fix", async () => {
    await reconcile(queue);

    const schedulers = await queue.getJobSchedulers();
    const mine = schedulers.find((s) => s.key === sourceId);
    expect(mine?.template?.opts?.attempts).toBe(3);
    expect(mine?.template?.opts?.backoff).toMatchObject({ type: "exponential", delay: 5000 });
  });

  it("removes the scheduler when the source is deactivated (the real bug this locks in)", async () => {
    await reconcile(queue);
    expect((await queue.getJobSchedulers()).some((s) => s.key === sourceId)).toBe(true);

    await prisma.source.update({ where: { id: sourceId }, data: { active: false } });
    await reconcile(queue);

    expect((await queue.getJobSchedulers()).some((s) => s.key === sourceId)).toBe(false);
  });

  it("updates the schedule when crawlInterval changes, without creating a duplicate", async () => {
    await reconcile(queue);
    await prisma.source.update({ where: { id: sourceId }, data: { crawlInterval: 1800 } });
    await reconcile(queue);

    const schedulers = await queue.getJobSchedulers();
    const mine = schedulers.filter((s) => s.key === sourceId);
    expect(mine).toHaveLength(1);
    expect(mine[0].every).toBe(1_800_000);
  });
});
