import bcrypt from "bcryptjs";
import { ENTITY_TYPE } from "@automotive/types";
import { prisma } from "./index.js";
import { bootstrapPlatformData } from "./bootstrap.js";

// Idempotent seed: safe to run repeatedly (upserts everywhere), matching
// spec §61 "idempotency" even for setup scripts, not just pipeline jobs.

// Real gap found and fixed 2026-09-08: permissions/roles/markets/sources/
// topics used to be defined and created directly in this file — but that's
// real production infrastructure (a production deploy needs the "admin"
// Role to exist before create-admin.ts can assign it, and real ingestion
// needs the real Source rows), not dev-only fixture data, yet this whole
// file refuses to run in production one paragraph down. Extracted into
// bootstrap.ts's bootstrapPlatformData() (safe in any environment); this
// file now only adds what's genuinely dev-only: the demo BMW knowledge-base
// rows and the hardcoded, publicly-known dev admin credential below.

// Real gap found and fixed 2026-09-07, same day as the AUTH_JWT_SECRET
// production guard (packages/config) — that fix closed one way a known,
// public credential could grant real admin access in production; this
// closes a second, parallel one. The seeded admin below has always been
// a hardcoded, well-known credential (`admin@dev.local` /
// `dev-admin-password`, printed to the console on every run) — the
// comment right above it already said "never run against a production
// database," but nothing anywhere actually enforced that, the same gap
// shape as the JWT secret before its own fix. Same "fail loud in
// production, never silently insecure" posture: refuses to run at all
// with `NODE_ENV=production`, rather than trusting a comment alone.
async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "This seed script inserts a known, public dev-only admin credential (admin@dev.local / dev-admin-password) and must never run against a production database. Refusing to run with NODE_ENV=production.",
    );
  }

  await bootstrapPlatformData();

  // Dev-only seeded admin so /v1/auth/login is actually testable end to
  // end. Password is intentionally simple and printed below — this is a
  // local-dev seed, never run against a production database with a real
  // domain/user base.
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: "admin" } });
  const adminPasswordHash = await bcrypt.hash("dev-admin-password", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@dev.local" },
    update: {},
    create: {
      email: "admin@dev.local",
      name: "Dev Admin",
      passwordHash: adminPasswordHash,
      status: "ACTIVE",
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  // Real automotive Knowledge Base data (spec §23-24), not placeholders —
  // proves Brand→CarModel→Generation→Trim→Engine end to end, plus the
  // time/market-aware Fact system (spec §90-91), before any AI pipeline
  // exists to populate this automatically.
  const usMarket = await prisma.market.findUniqueOrThrow({ where: { code: "US" } });

  const bmw = await prisma.brand.upsert({
    where: { slug: "bmw" },
    update: {},
    create: { slug: "bmw", name: "BMW", country: "DE" },
  });
  const series3 = await prisma.carModel.upsert({
    where: { brandId_slug: { brandId: bmw.id, slug: "3-series" } },
    update: {},
    create: { brandId: bmw.id, slug: "3-series", name: "3 Series" },
  });
  const g20 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: series3.id, slug: "g20" } },
    update: {},
    create: { carModelId: series3.id, slug: "g20", name: "G20", startYear: 2018, endYear: 2023 },
  });

  const trimDefs = [
    { slug: "330i", name: "330i", engine: { name: "B48 2.0L Turbo I4", powerHp: 255, fuel: "gasoline" } },
    { slug: "m340i", name: "M340i", engine: { name: "B58 3.0L Turbo I6", powerHp: 382, fuel: "gasoline" } },
    { slug: "m3-competition", name: "M3 Competition", engine: { name: "S58 3.0L Twin-Turbo I6", powerHp: 503, fuel: "gasoline" } },
  ];

  for (const trimDef of trimDefs) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: g20.id, slug: trimDef.slug } },
      update: {},
      create: { generationId: g20.id, slug: trimDef.slug, name: trimDef.name },
    });
    const existingEngine = await prisma.engine.findFirst({ where: { trimId: trim.id } });
    if (!existingEngine) {
      await prisma.engine.create({
        data: {
          trimId: trim.id,
          name: trimDef.engine.name,
          powerHp: trimDef.engine.powerHp,
          powerKw: Math.round(trimDef.engine.powerHp * 0.7457),
          fuel: trimDef.engine.fuel,
        },
      });
    }
  }

  // A time/market-scoped Fact, not a bare number — mirrors exactly how the
  // Fact Engine (docs/editorial-system.md) is meant to store this, even
  // though no AI pipeline wrote it yet.
  const existingFact = await prisma.fact.findFirst({
    where: { carModelId: series3.id, attribute: "m3_competition_power_hp", marketId: usMarket.id },
  });
  if (!existingFact) {
    await prisma.fact.create({
      data: {
        carModelId: series3.id,
        attribute: "m3_competition_power_hp",
        value: "503",
        unit: "hp",
        marketId: usMarket.id,
        status: "CONFIRMED",
        confidence: 0.98,
      },
    });
  }

  // A real example of the spec §29-31 Redirect entity in use — the kind
  // of thing that happens for real once a car page's slug format changes.
  await prisma.redirect.upsert({
    where: { fromPath: "/cars/bmw/3series" },
    update: {},
    create: { fromPath: "/cars/bmw/3series", toPath: "/cars/bmw/3-series", statusCode: 301 },
  });

  // A real example of the spec §25 Knowledge Graph's Car <-> Story edge,
  // linking to whatever real story the RSS ingestion has actually turned
  // up so far (see apps/worker) — findFirst + a null check rather than a
  // hard dependency, since a fresh environment with no ingestion run yet
  // won't have this specific story. Still seeded by hand, not redundant
  // with the real automated extraction that exists now
  // (packages/editorial's extractCarModelMentions(), wired into
  // apps/worker/src/ingest.ts): this exact headline ("3, 5 And 7 Series")
  // is a deliberate non-match there (no literal "3 Series" substring,
  // see that module's own test for why guessing would be unsafe), so it
  // still needs this manual edge.
  const bmwRecallStory = await prisma.story.findFirst({ where: { title: { contains: "3, 5 And 7 Series" } } });
  if (bmwRecallStory) {
    const existingRelation = await prisma.entityRelation.findFirst({
      where: { fromType: ENTITY_TYPE.STORY, fromId: bmwRecallStory.id, toType: ENTITY_TYPE.CAR_MODEL, toId: series3.id },
    });
    if (!existingRelation) {
      await prisma.entityRelation.create({
        data: {
          fromType: ENTITY_TYPE.STORY,
          fromId: bmwRecallStory.id,
          toType: ENTITY_TYPE.CAR_MODEL,
          toId: series3.id,
          relation: "mentions",
        },
      });
    }

    // Backfill: this Story was seeded before Topic classification existed
    // (apps/worker/src/ingest.ts only sets primaryTopicId for newly-created
    // stories going forward), so it would otherwise sit unclassified forever.
    if (!bmwRecallStory.primaryTopicId) {
      const safetyTopic = await prisma.topic.findUnique({ where: { slug: "safety-recalls" } });
      if (safetyTopic) {
        await prisma.story.update({ where: { id: bmwRecallStory.id }, data: { primaryTopicId: safetyTopic.id } });
      }
    }

    // Same backfill reasoning for StoryEvent (spec §52 "story evolution"):
    // this Story predates apps/worker/src/ingest.ts writing a "discovered"
    // event at creation time, so it would otherwise have an empty timeline
    // forever despite being real, already-ingested data.
    const hasDiscoveredEvent = await prisma.storyEvent.findFirst({
      where: { storyId: bmwRecallStory.id, label: "discovered" },
    });
    if (!hasDiscoveredEvent) {
      await prisma.storyEvent.create({
        data: {
          storyId: bmwRecallStory.id,
          occurredAt: bmwRecallStory.firstSeenAt,
          label: "discovered",
          description: `First reported by "Motor1"`,
        },
      });
    }
  }

  // Real gap found and fixed 2026-09-09 (this repo's first real GitHub
  // Actions run — see docs/deployment.md's own "written and reasoned
  // through by hand, not run-and-verified" note for why this was never
  // caught before): the homepage's "Latest" feed and per-Topic sections,
  // `/topics/:slug`, and `/admin/stories` only ever showed real content
  // in this session's own long-lived local dev DB, already full of real
  // Stories from days of real RSS ingestion. A genuinely fresh
  // environment (this seed script's exact job) had none — the
  // `bmwRecallStory` block above only creates real Story links when
  // ingestion already produced that exact headline, so on a fresh DB
  // nothing here created any Story at all. Same dev-only posture as the
  // rest of this file: idempotent (checks each topic's real count
  // first, never duplicates on a repeat run), still refused entirely in
  // production by the guard at the top of this function.
  const demoTopicMinStories: Record<string, number> = {
    "safety-recalls": 1,
    // apps/web/src/app/page.tsx only renders a "See all" link once a
    // topic's real story count exceeds the 5 it slices for display.
    "electric-vehicles": 6,
    // Deliberately <= 5 so this section renders WITHOUT a "See all"
    // link — proves that threshold both ways, not just the "has one".
    "market-business": 3,
  };
  for (const [slug, minCount] of Object.entries(demoTopicMinStories)) {
    const topic = await prisma.topic.findUnique({ where: { slug } });
    if (!topic) continue;
    const existing = await prisma.story.count({ where: { primaryTopicId: topic.id } });
    for (let i = existing; i < minCount; i++) {
      // Real gap found and fixed 2026-09-09, same tick: the first version
      // of this title literally embedded the real Topic name ("Dev seed:
      // Electric Vehicles story 1"), which collided with
      // page.getByRole('heading', { name: 'Electric Vehicles' }) in
      // apps/web/e2e/public-pages.spec.ts — Playwright's default
      // substring match found 2 real headings and failed strict mode.
      // Uses the topic's slug (hyphenated, never a substring of the
      // real space-separated section heading) instead of its name.
      await prisma.story.create({
        data: { title: `Dev seed story ${i + 1} (${slug})`, status: "DISCOVERED", primaryTopicId: topic.id },
      });
    }
  }

  console.log(`Dev admin login: admin@dev.local / dev-admin-password`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
