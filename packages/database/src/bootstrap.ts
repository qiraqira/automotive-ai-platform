import { prisma, PermissionKey } from "./index.js";

// Extracted from seed.ts 2026-09-08: permissions/roles/markets/sources/topics
// are real production infrastructure (every deployment needs the "admin"
// role to exist before create-admin.ts can assign it, and real ingestion
// needs real Source rows) — none of it is dev-only fixture data, unlike the
// demo BMW knowledge-base rows and the hardcoded dev admin credential that
// stay in seed.ts (which still refuses to run in production). Idempotent
// (upserts everywhere), safe to run repeatedly in any environment including
// production.

const ALL_PERMISSIONS = Object.values(PermissionKey);

const ROLES: { key: string; name: string; permissions: PermissionKey[] }[] = [
  { key: "admin", name: "Administrator", permissions: ALL_PERMISSIONS },
  {
    key: "editor",
    name: "Editor",
    permissions: [
      "READ_SOURCES",
      "CREATE_STORY",
      "UPDATE_STORY",
      "CREATE_ARTICLE",
      "UPDATE_ARTICLE",
      "PUBLISH_ARTICLE",
      "MODERATE_COMMENT",
      "UPDATE_CAR",
      "UPDATE_SEO",
      "RUN_RESEARCH",
      "GENERATE_IMAGE",
    ] as PermissionKey[],
  },
  {
    key: "ai_agent",
    name: "AI Editorial Agent",
    permissions: [
      "READ_SOURCES",
      "CREATE_STORY",
      "UPDATE_STORY",
      "CREATE_ARTICLE",
      "UPDATE_ARTICLE",
      "RUN_RESEARCH",
      "MODERATE_COMMENT",
    ] as PermissionKey[],
  },
];

const MARKETS = [
  { code: "US", name: "United States", currencyCode: "USD", unitSystem: "imperial" },
  { code: "GB", name: "United Kingdom", currencyCode: "GBP", unitSystem: "imperial" },
  { code: "ES", name: "Spain", currencyCode: "EUR", unitSystem: "metric" },
  { code: "MX", name: "Mexico", currencyCode: "MXN", unitSystem: "metric" },
];

const SOURCES = [
  {
    name: "Electrek",
    url: "https://electrek.co/",
    feedUrl: "https://electrek.co/feed/",
    country: "US",
    language: "en",
    type: "NEWS_MEDIA" as const,
    tier: "SPECIALIST" as const,
    trustScore: 78,
  },
  {
    name: "InsideEVs",
    url: "https://insideevs.com/",
    feedUrl: "https://insideevs.com/rss/articles/all/",
    country: "US",
    language: "en",
    type: "NEWS_MEDIA" as const,
    tier: "SPECIALIST" as const,
    trustScore: 78,
  },
  {
    name: "Motor1",
    url: "https://www.motor1.com/",
    feedUrl: "https://www.motor1.com/rss/articles/all/",
    country: "US",
    language: "en",
    type: "NEWS_MEDIA" as const,
    tier: "SPECIALIST" as const,
    trustScore: 75,
  },
];

// Matches packages/editorial/src/topic-classifier.ts's TOPIC_RULES slugs —
// kept as a separate literal (not imported) since @automotive/database
// can't depend on @automotive/editorial, which already depends on it.
const TOPICS = [
  { slug: "safety-recalls", name: "Safety & Recalls" },
  { slug: "electric-vehicles", name: "Electric Vehicles" },
  { slug: "market-business", name: "Market & Business" },
  { slug: "micromobility", name: "E-Bikes & Scooters" },
  { slug: "autonomous-robotaxi", name: "Autonomous & Robotaxis" },
];

export async function bootstrapPlatformData(): Promise<void> {
  for (const perm of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm },
      update: {},
      create: { key: perm },
    });
  }

  for (const roleDef of ROLES) {
    const role = await prisma.role.upsert({
      where: { key: roleDef.key },
      update: { name: roleDef.name },
      create: { key: roleDef.key, name: roleDef.name },
    });
    for (const permKey of roleDef.permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key: permKey } });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  for (const market of MARKETS) {
    await prisma.market.upsert({
      where: { code: market.code },
      update: market,
      create: market,
    });
  }

  for (const source of SOURCES) {
    await prisma.source.upsert({
      where: { url: source.url },
      update: source,
      create: source,
    });
  }

  for (const topic of TOPICS) {
    await prisma.topic.upsert({
      where: { slug: topic.slug },
      update: { name: topic.name },
      create: topic,
    });
  }

  console.log(
    `Bootstrapped: ${ALL_PERMISSIONS.length} permissions, ${ROLES.length} roles, ${MARKETS.length} markets, ${SOURCES.length} sources, ${TOPICS.length} topics.`,
  );
}

// CLI entry point (`npm run db:bootstrap`) so production deploys have a
// real way to run this without going through seed.ts (which refuses to
// run in production for unrelated, dev-fixture reasons). Guarded so
// `import { bootstrapPlatformData } from "./bootstrap.js"` (seed.ts's own
// usage) doesn't also re-run this as a side effect of the import itself.
if (process.argv[1]?.endsWith("bootstrap.ts") || process.argv[1]?.endsWith("bootstrap.js")) {
  bootstrapPlatformData()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
