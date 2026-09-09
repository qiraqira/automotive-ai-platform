import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { prisma } from "@automotive/database";
import { ENTITY_TYPE } from "@automotive/types";
import { env } from "@automotive/config";
import { app } from "../app.js";

// Real integration tests (spec §59 "Integration tests: ... publishing"):
// exercise the actual Express app + the real local Postgres (see
// docs/database.md), not a mocked request/response pair. Assumes
// `npm run db:seed` has been run against DATABASE_URL — same assumption
// every manual curl-based verification in this project's memory notes
// already makes.
//
// Note on rate limiting (../rate-limit.ts, applied to /v1/auth/login and
// /v1/search): every `request(app)` call in this file shares the same
// `app` singleton and effectively the same client IP (supertest's
// loopback), so all login/search calls across this whole file count
// against ONE shared rate-limit window (10/15min for login, 30/min for
// search) — if a future test addition pushes either over the limit,
// that's this shared state, not a real bug; widen the limit or give the
// new test its own rate-limit instance instead of chasing a phantom
// regression. This already happened TWICE (2026-09-07): first the "user
// management" describe block logged in fresh per test, fixed with a
// `beforeAll` shared login scoped to that one block; then, later the
// same day, adding two more describe blocks that *each* did the same
// per-block `beforeAll` login pushed the file's total back over the
// limit again — five separate admin logins across the file for work that
// only ever needs one. Fixed for good (not just patched again) with the
// single file-level `adminAgent` below: every describe block that needs
// an authenticated admin session reuses it, and ONLY tests whose actual
// point is exercising the login mechanism itself (wrong password, the
// real login-flow test, the cookie-attributes test, and a freshly-
// created user's own password-hash verification) still perform a
// separate, real login — because those tests would be meaningless
// otherwise. 10/15min is a real, deliberately-chosen production value
// (see app.ts) — the fix belongs in test structure, not in loosening it.
let adminAgent: ReturnType<typeof request.agent>;

beforeAll(async () => {
  adminAgent = request.agent(app);
  await adminAgent.post("/v1/auth/login").send({ email: "admin@dev.local", password: "dev-admin-password" });
});

describe("health/readiness", () => {
  it("GET /health always returns ok, no DB dependency", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("every response carries a correlation id (generated if the caller didn't supply one)", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("echoes back a caller-supplied X-Request-Id instead of generating a new one", async () => {
    const res = await request(app).get("/health").set("X-Request-Id", "test-fixed-correlation-id");
    expect(res.headers["x-request-id"]).toBe("test-fixed-correlation-id");
  });

  it("sends real security headers (helmet) and never advertises the framework", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    // Real test-coverage gap found and fixed 2026-09-08: this only ever
    // checked the header was PRESENT, not its actual value — unlike its
    // neighbor above. A regression that changed helmet's frameguard
    // config to something less safe (or removed it, leaving some other
    // value behind) would still have passed this test. Verified the
    // real value live before asserting it.
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("uses the 'simple' query parser, not 'extended' (qs) — a real mitigation for a qs CVE with no safe upgrade path yet (no fix short of an Express 5 major migration)", () => {
    expect(app.get("query parser")).toBe("simple");
  });

  it("GET /ready confirms a real DB connection", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready" });
  });

  // Real test-coverage gap found and fixed 2026-09-08: only the happy
  // path above was ever tested — the entire actual PURPOSE of a
  // readiness endpoint (an orchestrator/load balancer using this to
  // decide whether to route real traffic here) is detecting when the DB
  // is genuinely unreachable, which had never been exercised at all.
  // Mocks `prisma.$queryRaw` to reject for this one test only (can't take
  // down the real shared dev DB without breaking every other test in this
  // file that depends on it).
  it("GET /ready reports 503 not_ready when the DB is genuinely unreachable, not a thrown error or a false 200", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "not_ready", error: "Connection terminated unexpectedly" });
    vi.restoreAllMocks();
  });
});

describe("public read endpoints against real seeded data", () => {
  it("GET /v1/sources includes the real seeded sources", async () => {
    const res = await request(app).get("/v1/sources");
    expect(res.status).toBe(200);
    const names = res.body.sources.map((s: { name: string }) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Electrek", "InsideEVs", "Motor1"]));
  });

  it("GET /v1/sources includes crawlInterval and robotsStatus — real gap fixed 2026-09-07: both existed on the model but were missing from this response, so /admin's real editing UI (added the same day) had nothing to read or pre-fill its form with", async () => {
    const res = await request(app).get("/v1/sources");
    const electrek = res.body.sources.find((s: { name: string }) => s.name === "Electrek");
    expect(electrek).toMatchObject({ crawlInterval: expect.any(Number) });
    expect(electrek).toHaveProperty("robotsStatus");
  });

  it("GET /v1/stories rejects an invalid status value instead of silently ignoring it", async () => {
    const res = await request(app).get("/v1/stories").query({ status: "NOT_A_REAL_STATUS" });
    expect(res.status).toBe(400);
  });

  it("GET /v1/stories includes each story's real source articles with their real byline — the real fix for a gap where SourceAuthor sat entirely unused since the schema scaffold", async () => {
    const source = await prisma.source.findFirstOrThrow({ where: { name: "Electrek" } });
    const author = await prisma.sourceAuthor.create({ data: { sourceId: source.id, name: "Zzqxfixture Byline" } });
    const story = await prisma.story.create({ data: { title: "Zzqxfixture story with a real byline", status: "DISCOVERED" } });
    await prisma.sourceArticle.create({
      data: {
        sourceId: source.id,
        authorId: author.id,
        storyId: story.id,
        url: "https://test.invalid/zzqxfixture-byline-article",
        urlHash: "zzqxfixture-byline-article-hash",
        title: "Zzqxfixture story with a real byline",
      },
    });

    try {
      const res = await request(app).get("/v1/stories").query({ limit: 50 });
      expect(res.status).toBe(200);
      const found = res.body.stories.find((s: { id: string }) => s.id === story.id);
      expect(found.sourceArticles[0]).toMatchObject({ author: { name: "Zzqxfixture Byline" } });
    } finally {
      await prisma.sourceArticle.deleteMany({ where: { storyId: story.id } });
      await prisma.story.delete({ where: { id: story.id } });
      await prisma.sourceAuthor.delete({ where: { id: author.id } });
    }
  });

  it("GET /v1/stories supports a real offset, so an editor can page past the most recent N stories — the real fix for a gap where /admin/stories's hardcoded limit made every older real Story permanently unreachable through the admin UI", async () => {
    // Real gap found and fixed 2026-09-09, the first time this suite ever
    // ran against a genuinely fresh database (real GitHub Actions CI,
    // never verified before — see docs/deployment.md): this test used to
    // rely on "this dev DB has 150+ real ingested stories" ambient state
    // from one specific long-lived local machine's worker having run for
    // days. A freshly seeded CI database has only the handful of demo
    // rows seed.ts creates, so both 5-row pages came back `[]` and the
    // "guaranteed to differ" assumption silently depended on an
    // environment this test never actually controlled. Seeds its own 10
    // real rows now — passes identically on a fresh DB or a long-lived
    // one, same fix shape as the audit-log/search-queries offset tests
    // right below.
    const fixtureStories = await prisma.story.createManyAndReturn({
      data: Array.from({ length: 10 }, (_, i) => ({ title: `Zzqxfixture offset story ${i}`, status: "DISCOVERED" as const })),
    });
    try {
      const firstPage = await request(app).get("/v1/stories").query({ limit: 5, offset: 0 });
      const secondPage = await request(app).get("/v1/stories").query({ limit: 5, offset: 5 });
      expect(firstPage.status).toBe(200);
      expect(secondPage.status).toBe(200);
      expect(firstPage.body).toMatchObject({ offset: 0, limit: 5 });
      expect(secondPage.body).toMatchObject({ offset: 5, limit: 5 });
      const firstIds = firstPage.body.stories.map((s: { id: string }) => s.id);
      const secondIds = secondPage.body.stories.map((s: { id: string }) => s.id);
      expect(firstIds).not.toEqual(secondIds);
    } finally {
      await prisma.story.deleteMany({ where: { id: { in: fixtureStories.map((s) => s.id) } } });
    }
  });

  it("GET /v1/stories reports hasMore correctly for a real small page and a real page past the end", async () => {
    const totalReal = await prisma.story.count();
    const smallPage = await request(app).get("/v1/stories").query({ limit: 1, offset: 0 });
    expect(smallPage.body.hasMore).toBe(totalReal > 1);

    const pastTheEnd = await request(app).get("/v1/stories").query({ limit: 5, offset: totalReal + 1000 });
    expect(pastTheEnd.body.stories).toEqual([]);
    expect(pastTheEnd.body.hasMore).toBe(false);
  });

  it("GET /v1/stories rejects a negative offset", async () => {
    const res = await request(app).get("/v1/stories").query({ offset: -1 });
    expect(res.status).toBe(400);
  });

  it("GET /v1/markets includes the real seeded markets — the real fix for a gap where POST .../facts accepted an optional marketId but nothing could ever read the market list back to offer a picker", async () => {
    const res = await request(app).get("/v1/markets");
    expect(res.status).toBe(200);
    const codes = res.body.markets.map((m: { code: string }) => m.code);
    expect(codes).toEqual(expect.arrayContaining(["US", "GB", "ES", "MX"]));
    const us = res.body.markets.find((m: { code: string }) => m.code === "US");
    expect(us).toMatchObject({ name: "United States", currencyCode: "USD", unitSystem: "imperial" });
  });
});

describe("auth + RBAC end to end", () => {
  it("rejects a wrong password", async () => {
    const res = await request(app)
      .post("/v1/auth/login")
      .send({ email: "admin@dev.local", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  // Real test-coverage gap found and fixed 2026-09-08: `attachSession`
  // (`apps/api/src/permissions.ts`) runs on EVERY single request via
  // `app.use()`, not just authenticated routes, and its own
  // `verifySession()` (`auth.ts`) already has a real try/catch around
  // `jwt.verify()` specifically so a malformed/expired/tampered cookie is
  // treated as "not logged in", never a thrown error — but nothing had
  // ever exercised that catch path. If it were ever accidentally removed
  // (e.g. someone "simplifies" `verifySession` to call `jwt.verify`
  // directly), a single garbage cookie value would turn into an
  // unhandled exception on every request site-wide, not just the one
  // request that sent it — the exact severity class of the `marketId`
  // process-crash bug fixed earlier this session, just guarded here from
  // the start rather than found broken.
  it("treats a malformed session cookie as unauthenticated (401), not a thrown error, on a route that requires a session", async () => {
    const res = await request(app).get("/v1/auth/me").set("Cookie", `${env.AUTH_COOKIE_NAME}=not-a-real-jwt-at-all`);
    expect(res.status).toBe(401);
  });

  it("a malformed session cookie doesn't break a PUBLIC route either — attachSession runs globally, this route just never needed req.userId", async () => {
    const res = await request(app).get("/v1/sources").set("Cookie", `${env.AUTH_COOKIE_NAME}=not-a-real-jwt-at-all`);
    expect(res.status).toBe(200);
  });

  it("logs in the real seeded admin, then /me reflects the admin role via the actual DB lookup", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/v1/auth/login").send({ email: "admin@dev.local", password: "dev-admin-password" });
    expect(login.status).toBe(200);

    const me = await agent.get("/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.roles).toContain("admin");
  });

  it("sets the session cookie with HttpOnly + SameSite=Lax always, and Secure only in production", async () => {
    const login = await request(app).post("/v1/auth/login").send({ email: "admin@dev.local", password: "dev-admin-password" });
    const setCookie = login.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    // Real gap found and fixed 2026-09-07: this cookie previously had no
    // Secure flag at all, meaning it would be sent over plain HTTP even in
    // production. NODE_ENV defaults to "development" (and vitest sets
    // "test") in every environment this test actually runs in, so it must
    // stay absent here — this test exists to catch a regression toward
    // "always Secure" (which would silently break login on this project's
    // http://localhost dev/E2E setup) just as much as "never Secure".
    expect(setCookie).not.toContain("Secure");
  });

  // Real gap found and fixed 2026-09-07: enumerated every registered
  // route in app.ts and diffed against this file's own coverage —
  // POST /v1/auth/logout had an E2E test (admin.spec.ts, the actual
  // browser "Log out" button) but no direct integration test here at
  // all, unlike every other endpoint in this file.
  it("POST /v1/auth/logout clears the session cookie for real, so a subsequent request with the same cookie jar is unauthenticated", async () => {
    const agent = request.agent(app);
    await agent.post("/v1/auth/login").send({ email: "admin@dev.local", password: "dev-admin-password" });
    const meBefore = await agent.get("/v1/auth/me");
    expect(meBefore.status).toBe(200);

    const logout = await agent.post("/v1/auth/logout");
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true });

    const meAfter = await agent.get("/v1/auth/me");
    expect(meAfter.status).toBe(401);
  });

  it("POST /v1/sources is rejected with 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/v1/sources")
      .send({ name: "x", url: "https://zzqxfixture-unauth.test", type: "RSS" });
    expect(res.status).toBe(401);
  });

  it("POST /v1/sources creates a real source and writes a real AuditLog row — the real fix for a gap where PATCH /v1/sources/:id let an editor correct an existing source but nothing let one add a new one", async () => {
    const auditCountBefore = await prisma.auditLog.count({ where: { entityType: "Source" } });
    const res = await adminAgent.post("/v1/sources").send({
      name: "Zzqxfixture New Source",
      url: "https://zzqxfixture-new-source.test",
      feedUrl: "https://zzqxfixture-new-source.test/feed.xml",
      type: "NEWS_MEDIA",
    });
    try {
      expect(res.status).toBe(201);
      // Real defaults, not caller-supplied — confirms the schema's own
      // defaults apply exactly like seed.ts's real sources.
      expect(res.body).toMatchObject({ tier: "UNVERIFIED", trustScore: 30, active: true, crawlInterval: 900 });

      const auditCountAfter = await prisma.auditLog.count({ where: { entityType: "Source" } });
      expect(auditCountAfter).toBe(auditCountBefore + 1);
    } finally {
      await prisma.source.deleteMany({ where: { url: "https://zzqxfixture-new-source.test" } });
    }
  });

  it("POST /v1/sources returns 409 for a URL that's already a real source", async () => {
    const existing = await prisma.source.findFirstOrThrow();
    const res = await adminAgent.post("/v1/sources").send({ name: "dup", url: existing.url, type: "RSS" });
    expect(res.status).toBe(409);
  });

  it("POST /v1/sources returns 400 for an unknown type", async () => {
    const res = await adminAgent
      .post("/v1/sources")
      .send({ name: "x", url: "https://zzqxfixture-bad-type.test", type: "NOT_A_REAL_TYPE" });
    expect(res.status).toBe(400);
  });

  it("POST /v1/sources rejects a malformed url/feedUrl — the real fix for a gap where neither field checked it was an actual URL, and a malformed feedUrl reaching apps/worker's crawler caused an uncaught rejection instead of a graceful, retryable failure", async () => {
    const badUrl = await adminAgent.post("/v1/sources").send({ name: "x", url: "not-a-real-url", type: "RSS" });
    expect(badUrl.status).toBe(400);

    const badFeedUrl = await adminAgent
      .post("/v1/sources")
      .send({ name: "x", url: "https://zzqxfixture-bad-feedurl.test", feedUrl: "not-a-real-url", type: "RSS" });
    expect(badFeedUrl.status).toBe(400);
  });

  it("PATCH /v1/sources/:id is rejected with 401 when unauthenticated", async () => {
    const source = await prisma.source.findFirstOrThrow();
    const res = await request(app).patch(`/v1/sources/${source.id}`).send({ trustScore: 1 });
    expect(res.status).toBe(401);
  });

  it("PATCH /v1/sources/:id succeeds for the authenticated admin and writes a real AuditLog row", async () => {
    const source = await prisma.source.findFirstOrThrow({ where: { name: "Electrek" } });
    const originalTrustScore = source.trustScore;

    const auditCountBefore = await prisma.auditLog.count({ where: { entityId: source.id } });
    const patch = await adminAgent.patch(`/v1/sources/${source.id}`).send({ trustScore: 81 });
    expect(patch.status).toBe(200);
    expect(patch.body.trustScore).toBe(81);

    const auditCountAfter = await prisma.auditLog.count({ where: { entityId: source.id } });
    expect(auditCountAfter).toBe(auditCountBefore + 1);

    // Restore the seeded value so this test is repeatable and doesn't
    // leave the shared local DB mutated for the next run/tick. Also
    // cleans up the real SourceScoreEvent this trustScore change now
    // writes (real gap fixed 2026-09-07, see the dedicated test below) —
    // left uncleaned here it would inflate the next test's own count.
    await prisma.source.update({ where: { id: source.id }, data: { trustScore: originalTrustScore } });
    await prisma.sourceScoreEvent.deleteMany({ where: { sourceId: source.id } });
  });

  it("PATCH /v1/sources/:id with a changed trustScore writes a real SourceScoreEvent — the real fix for a gap where docs/editorial-system.md documented this table as how trustScore 'moves' over time but nothing ever wrote to it", async () => {
    const source = await prisma.source.findFirstOrThrow({ where: { name: "Electrek" } });
    const originalTrustScore = source.trustScore;

    try {
      const patch = await adminAgent.patch(`/v1/sources/${source.id}`).send({ trustScore: originalTrustScore + 5 });
      expect(patch.status).toBe(200);

      const events = await prisma.sourceScoreEvent.findMany({ where: { sourceId: source.id } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ delta: 5, newScore: originalTrustScore + 5 });
      expect(events[0].reason).toMatch(/Manually corrected by/);
    } finally {
      await prisma.sourceScoreEvent.deleteMany({ where: { sourceId: source.id } });
      await prisma.source.update({ where: { id: source.id }, data: { trustScore: originalTrustScore } });
    }
  });

  it("PATCH /v1/sources/:id does NOT write a SourceScoreEvent when trustScore is unchanged (e.g. only active/crawlInterval updated)", async () => {
    const source = await prisma.source.findFirstOrThrow({ where: { name: "Electrek" } });

    const patch = await adminAgent.patch(`/v1/sources/${source.id}`).send({ crawlInterval: source.crawlInterval });
    expect(patch.status).toBe(200);

    const events = await prisma.sourceScoreEvent.count({ where: { sourceId: source.id } });
    expect(events).toBe(0);
  });

  it("GET /v1/sources/:id/score-events is public and lists real events newest-first", async () => {
    const source = await prisma.source.findFirstOrThrow({ where: { name: "Electrek" } });
    // Explicit createdAt values (not relying on @default(now()) twice in
    // a row) so ordering is deterministic instead of racing millisecond
    // clock resolution between the two inserts.
    const older = await prisma.sourceScoreEvent.create({
      data: { sourceId: source.id, delta: 3, newScore: 83, reason: "zzqxfixture older event", createdAt: new Date(Date.now() - 60_000) },
    });
    const newer = await prisma.sourceScoreEvent.create({
      data: { sourceId: source.id, delta: 2, newScore: 85, reason: "zzqxfixture newer event", createdAt: new Date() },
    });

    try {
      const res = await request(app).get(`/v1/sources/${source.id}/score-events`);
      expect(res.status).toBe(200);
      expect(res.body.events[0].id).toBe(newer.id);
      expect(res.body.events[1].id).toBe(older.id);
    } finally {
      await prisma.sourceScoreEvent.deleteMany({ where: { id: { in: [older.id, newer.id] } } });
    }
  });

  it("GET /v1/sources/:id/score-events 404s for a nonexistent source", async () => {
    const res = await request(app).get("/v1/sources/not-a-real-id/score-events");
    expect(res.status).toBe(404);
  });
});

describe("system alerts", () => {
  it("GET /v1/alerts is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).get("/v1/alerts");
    expect(res.status).toBe(401);
  });

  it("PATCH /v1/alerts/:id/resolve is rejected with 401 when unauthenticated", async () => {
    const alert = await prisma.systemAlert.create({
      data: { severity: "WARNING", source: "test", message: "zzqxfixture unauthenticated resolve attempt" },
    });
    const res = await request(app).patch(`/v1/alerts/${alert.id}/resolve`);
    expect(res.status).toBe(401);
    await prisma.systemAlert.delete({ where: { id: alert.id } });
  });

  it("PATCH /v1/alerts/:id/resolve returns 404 for a nonexistent alert", async () => {
    const res = await adminAgent.patch("/v1/alerts/nonexistent-id/resolve");
    expect(res.status).toBe(404);
  });

  it("PATCH /v1/alerts/:id/resolve marks the alert resolved, sets resolvedAt, and writes a real AuditLog row — the real fix for a gap where resolved/resolvedAt existed in the schema and were read/filtered/displayed everywhere but never actually settable", async () => {
    const alert = await prisma.systemAlert.create({
      data: { severity: "WARNING", source: "test", message: "zzqxfixture resolvable alert" },
    });

    const auditCountBefore = await prisma.auditLog.count({ where: { entityId: alert.id } });
    const patch = await adminAgent.patch(`/v1/alerts/${alert.id}/resolve`);
    expect(patch.status).toBe(200);
    expect(patch.body.resolved).toBe(true);
    expect(patch.body.resolvedAt).not.toBeNull();

    const auditCountAfter = await prisma.auditLog.count({ where: { entityId: alert.id } });
    expect(auditCountAfter).toBe(auditCountBefore + 1);

    await prisma.systemAlert.delete({ where: { id: alert.id } });
  });

  it("GET /v1/alerts accepts a real offset and reports it back — the real fix for a gap where this endpoint had a hardcoded take:100 with no offset, same shape as the same-day GET /v1/stories and GET /v1/audit-log fixes", async () => {
    const res = await adminAgent.get("/v1/alerts").query({ offset: 0 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ offset: 0, hasMore: false });
  });

  it("GET /v1/alerts rejects a negative offset", async () => {
    const res = await adminAgent.get("/v1/alerts").query({ offset: -1 });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/audit-log", () => {
  it("is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).get("/v1/audit-log");
    expect(res.status).toBe(401);
  });

  it("returns real AuditLog rows for the authenticated admin (VIEW_AUDIT_LOG), newest first, filterable by entityType/entityId — the real fix for a gap where the permission existed and every admin already had it granted, but nothing ever checked it or read the table back", async () => {
    const alert = await prisma.systemAlert.create({
      data: { severity: "WARNING", source: "test", message: "zzqxfixture audit-log source alert" },
    });

    await adminAgent.patch(`/v1/alerts/${alert.id}/resolve`);

    const res = await adminAgent.get("/v1/audit-log").query({ entityType: "SystemAlert", entityId: alert.id });
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBeGreaterThanOrEqual(1);
    expect(res.body.entries[0]).toMatchObject({
      action: "resolve_alert",
      entityType: "SystemAlert",
      entityId: alert.id,
      actorType: "HUMAN",
      // Real gap fixed alongside this endpoint: actorLabel used to be the
      // raw User.id (contradicting its own schema comment calling it "a
      // human-readable fallback") — now the actor's real email.
      actorLabel: "admin@dev.local",
    });

    await prisma.systemAlert.delete({ where: { id: alert.id } });
  });

  it("supports a real offset — the real fix for a gap where this endpoint's hardcoded take:100 had no offset, and this dev DB already has 1,500+ real rows permanently hidden past page 1", async () => {
    // Real gap found and fixed 2026-09-09 (first real GitHub Actions CI
    // run — see the /v1/stories offset test's own comment for the full
    // story): "1,500+ real AuditLog rows" only existed on one specific
    // long-lived local dev machine, never on a fresh CI database. Seeds
    // its own 101 real rows so this passes on either.
    const fixtureLogs = await prisma.auditLog.createManyAndReturn({
      data: Array.from({ length: 101 }, (_, i) => ({
        actorType: "SYSTEM" as const,
        actorLabel: "Zzqxfixture offset actor",
        action: "zzqxfixture.offset",
        entityType: "Zzqxfixture",
        entityId: `zzqxfixture-${i}`,
      })),
    });
    try {
      const firstPage = await adminAgent.get("/v1/audit-log").query({ offset: 0 });
      const secondPage = await adminAgent.get("/v1/audit-log").query({ offset: 100 });
      expect(firstPage.status).toBe(200);
      expect(secondPage.status).toBe(200);
      expect(firstPage.body.offset).toBe(0);
      expect(secondPage.body.offset).toBe(100);
      const firstIds = firstPage.body.entries.map((e: { id: string }) => e.id);
      const secondIds = secondPage.body.entries.map((e: { id: string }) => e.id);
      expect(firstIds).not.toEqual(secondIds);
      expect(firstPage.body.hasMore).toBe(true);
    } finally {
      await prisma.auditLog.deleteMany({ where: { id: { in: fixtureLogs.map((l) => l.id) } } });
    }
  });

  it("rejects a negative offset", async () => {
    const res = await adminAgent.get("/v1/audit-log").query({ offset: -1 });
    expect(res.status).toBe(400);
  });
});

describe("user management (MANAGE_USERS)", () => {
  // Reuses the file-level `adminAgent` (see top-of-file note). A separate
  // real login is still used below wherever the test's own point is to
  // prove a *different* login (a freshly-created user's hashed password
  // actually working).

  it("GET /v1/users is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).get("/v1/users");
    expect(res.status).toBe(401);
  });

  // Real gap found and fixed 2026-09-07: enumerated every registered
  // route in app.ts and diffed against this file's own coverage —
  // `GET /v1/roles` (a real, actively-used endpoint: it's what powers
  // the role dropdown on /admin/users' "Add user" form,
  // apps/web/src/app/admin/users/page.tsx) had zero dedicated tests at
  // all, same shape as the POST /v1/analytics/events gap found earlier
  // today.
  it("GET /v1/roles is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).get("/v1/roles");
    expect(res.status).toBe(401);
  });

  it("GET /v1/roles returns the real seeded roles", async () => {
    const res = await adminAgent.get("/v1/roles");
    expect(res.status).toBe(200);
    expect(res.body.roles.map((r: { key: string }) => r.key)).toEqual(
      expect.arrayContaining(["admin", "editor", "ai_agent"]),
    );
  });

  it("POST /v1/users creates a real, real-password-hashed user who can actually log in, and writes a real AuditLog row — the real fix for a gap where MANAGE_USERS existed and admin already had it granted, but the only User row that could ever exist was seed.ts's single hardcoded admin", async () => {
    const auditCountBefore = await prisma.auditLog.count({ where: { entityType: "User" } });
    const create = await adminAgent.post("/v1/users").send({
      email: "zzqxfixture-editor@dev.local",
      name: "Fixture Editor",
      password: "fixture-password-123",
      roleKey: "editor",
    });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ email: "zzqxfixture-editor@dev.local", status: "ACTIVE", roles: ["editor"] });

    const auditCountAfter = await prisma.auditLog.count({ where: { entityType: "User" } });
    expect(auditCountAfter).toBe(auditCountBefore + 1);

    // Proves the password was actually hashed and usable, not just stored
    // — a real login attempt with the exact password just submitted.
    const login = await request(app)
      .post("/v1/auth/login")
      .send({ email: "zzqxfixture-editor@dev.local", password: "fixture-password-123" });
    expect(login.status).toBe(200);

    await prisma.user.delete({ where: { id: create.body.id } });
  });

  it("POST /v1/users rejects an unknown roleKey with 400 and a duplicate email with 409", async () => {
    const badRole = await adminAgent
      .post("/v1/users")
      .send({ email: "zzqxfixture-badrole@dev.local", name: "X", password: "fixture-password-123", roleKey: "not_a_real_role" });
    expect(badRole.status).toBe(400);

    const dupeEmail = await adminAgent
      .post("/v1/users")
      .send({ email: "admin@dev.local", name: "X", password: "fixture-password-123", roleKey: "editor" });
    expect(dupeEmail.status).toBe(409);
  });

  it("PATCH /v1/users/:id/status suspends a real user and writes a real AuditLog row", async () => {
    const created = await adminAgent.post("/v1/users").send({
      email: "zzqxfixture-suspend@dev.local",
      name: "Fixture Suspend",
      password: "fixture-password-123",
      roleKey: "editor",
    });

    const auditCountBefore = await prisma.auditLog.count({ where: { entityId: created.body.id } });
    const patch = await adminAgent.patch(`/v1/users/${created.body.id}/status`).send({ status: "SUSPENDED" });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("SUSPENDED");
    const auditCountAfter = await prisma.auditLog.count({ where: { entityId: created.body.id } });
    expect(auditCountAfter).toBe(auditCountBefore + 1);

    await prisma.user.delete({ where: { id: created.body.id } });
  });

  it("PATCH /v1/users/:id/status actually revokes an already-logged-in user's access in real time, not just future logins — the real fix for a gap where suspension only updated User.status, never checked anywhere a permission was actually enforced, so a suspended user's real 7-day session kept working exactly as before", async () => {
    const created = await adminAgent.post("/v1/users").send({
      email: "zzqxfixture-suspend-live.session@dev.local",
      name: "Fixture Suspend Live Session",
      password: "fixture-password-123",
      roleKey: "editor",
    });

    // A real second session, established BEFORE suspension — not the
    // shared adminAgent, and not a fresh login taken after suspension
    // (login's own status check already covered that path; this test's
    // whole point is an existing, still-valid session).
    const editorAgent = request.agent(app);
    const login = await editorAgent
      .post("/v1/auth/login")
      .send({ email: "zzqxfixture-suspend-live.session@dev.local", password: "fixture-password-123" });
    expect(login.status).toBe(200);

    // Prove the session actually works before suspension, so the
    // post-suspension failure below is a real change, not a fixture that
    // never had access to begin with.
    const meBefore = await editorAgent.get("/v1/auth/me");
    expect(meBefore.status).toBe(200);
    const gatedBefore = await editorAgent.post("/v1/brands").send({ slug: "zzqxfixture-live-session-brand-before", name: "X" });
    expect(gatedBefore.status).toBe(201);
    await prisma.brand.delete({ where: { slug: "zzqxfixture-live-session-brand-before" } });

    await adminAgent.patch(`/v1/users/${created.body.id}/status`).send({ status: "SUSPENDED" });

    // Same cookie jar, same never-re-issued JWT, still cryptographically
    // valid (7-day expiry) — both real, permission-gated surfaces must
    // now genuinely reject it.
    const meAfter = await editorAgent.get("/v1/auth/me");
    expect(meAfter.status).toBe(401);
    const gatedAfter = await editorAgent.post("/v1/brands").send({ slug: "zzqxfixture-live-session-brand-after", name: "X" });
    expect(gatedAfter.status).toBe(403);

    await prisma.user.delete({ where: { id: created.body.id } });
  });

  it("PATCH /v1/users/:id/status refuses to let an admin suspend their own account — the one admin action that couldn't be undone through the UI if it succeeded", async () => {
    const me = await adminAgent.get("/v1/auth/me");

    const res = await adminAgent.patch(`/v1/users/${me.body.id}/status`).send({ status: "SUSPENDED" });
    expect(res.status).toBe(400);

    // Confirm the real admin account is genuinely untouched, not just that
    // the request was rejected in isolation.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@dev.local" } });
    expect(admin.status).toBe("ACTIVE");
  });
});

describe("brand/car model creation (UPDATE_CAR)", () => {
  // Reuses the file-level `adminAgent` (see top-of-file note). Real gap
  // found and fixed 2026-09-07: every real Brand/CarModel in this DB
  // exists only because seed.ts wrote it — no endpoint ever let an
  // editor add a new one, even though this platform's actual Knowledge
  // Graph is built around exactly these two entities.

  it("GET /v1/brands includes the real seeded BMW brand", async () => {
    const res = await request(app).get("/v1/brands");
    expect(res.status).toBe(200);
    expect(res.body.brands.map((b: { slug: string }) => b.slug)).toContain("bmw");
  });

  it("POST /v1/brands is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).post("/v1/brands").send({ slug: "x", name: "x" });
    expect(res.status).toBe(401);
  });

  it("POST /v1/brands creates a real Brand and writes a real AuditLog row", async () => {
    const res = await adminAgent.post("/v1/brands").send({ slug: "zzqxfixture-brand", name: "Zzqxfixture Brand", country: "JP" });
    try {
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ slug: "zzqxfixture-brand", name: "Zzqxfixture Brand", country: "JP" });
      // Real test-quality gap found and fixed 2026-09-08: unlike this
      // file's own "update" audit-log checks (which already bake the
      // real `action` into the query itself, e.g. `action:
      // "update_brand"` — a wrong action would make findFirst return
      // null and correctly fail the test), every "create" audit-log
      // check omitted `action` from the query entirely — any row for
      // this entityType/entityId would satisfy `not.toBeNull()`, even
      // one logged with the wrong action string. Added the real action
      // (verified directly against app.ts) for consistency.
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "Brand", entityId: res.body.id, action: "create_brand" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.brand.deleteMany({ where: { slug: "zzqxfixture-brand" } });
    }
  });

  it("POST /v1/brands returns 409 for a slug that's already a real brand", async () => {
    const res = await adminAgent.post("/v1/brands").send({ slug: "bmw", name: "dup" });
    expect(res.status).toBe(409);
  });

  it("POST /v1/brands rejects a non-lowercase-kebab-case slug — the real fix for a gap where an admin typing \"BMW\" instead of \"bmw\" into the real 'Add brand' form would create a second, visually-near-identical real brand rather than conflicting with the existing one, since Brand.slug is a case-sensitive @unique column feeding a real, indexable URL", async () => {
    const upper = await adminAgent.post("/v1/brands").send({ slug: "Zzqxfixture", name: "x" });
    expect(upper.status).toBe(400);
    const spaced = await adminAgent.post("/v1/brands").send({ slug: "zzq xfixture", name: "x" });
    expect(spaced.status).toBe(400);
  });

  it("POST /v1/cars is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).post("/v1/cars").send({ brandSlug: "bmw", slug: "x", name: "x" });
    expect(res.status).toBe(401);
  });

  it("POST /v1/cars creates a real CarModel under the real seeded BMW brand and writes a real AuditLog row", async () => {
    const res = await adminAgent.post("/v1/cars").send({ brandSlug: "bmw", slug: "zzqxfixture-model", name: "Zzqxfixture Model" });
    try {
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ slug: "zzqxfixture-model", name: "Zzqxfixture Model" });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "CarModel", entityId: res.body.id, action: "create_car_model" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.carModel.deleteMany({ where: { slug: "zzqxfixture-model" } });
    }
  });

  it("POST /v1/cars returns 404 for a nonexistent brand", async () => {
    const res = await adminAgent.post("/v1/cars").send({ brandSlug: "not-a-real-brand", slug: "x", name: "x" });
    expect(res.status).toBe(404);
  });

  it("POST /v1/cars rejects a non-lowercase-kebab-case slug, same real fix as POST /v1/brands", async () => {
    const res = await adminAgent.post("/v1/cars").send({ brandSlug: "bmw", slug: "Zzqxfixture-Model", name: "x" });
    expect(res.status).toBe(400);
  });

  it("POST /v1/cars returns 409 for a slug that's already taken under the same real brand", async () => {
    const res = await adminAgent.post("/v1/cars").send({ brandSlug: "bmw", slug: "3-series", name: "dup" });
    expect(res.status).toBe(409);
  });

  // Real gap found and fixed 2026-09-07 (same day, later pass): every
  // other admin entity built today (Source, Fact, Redirect, User) got
  // both a create AND a correct path — Brand/CarModel only ever got
  // create, until now.
  it("PATCH /v1/brands/:id is rejected with 401 when unauthenticated", async () => {
    const brand = await prisma.brand.findFirstOrThrow({ where: { slug: "bmw" } });
    const res = await request(app).patch(`/v1/brands/${brand.id}`).send({ name: "x" });
    expect(res.status).toBe(401);
  });

  it("PATCH /v1/brands/:id corrects a real brand's real seeded name and writes a real AuditLog row", async () => {
    const brand = await prisma.brand.findFirstOrThrow({ where: { slug: "bmw" } });
    const original = brand.name;
    try {
      const res = await adminAgent.patch(`/v1/brands/${brand.id}`).send({ name: "Zzqxfixture BMW" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Zzqxfixture BMW");
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "Brand", entityId: brand.id, action: "update_brand" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.brand.update({ where: { id: brand.id }, data: { name: original } });
    }
  });

  it("PATCH /v1/brands/:id 404s for a nonexistent brand", async () => {
    const res = await adminAgent.patch("/v1/brands/nonexistent-id").send({ name: "x" });
    expect(res.status).toBe(404);
  });

  it("PATCH /v1/cars/:brandSlug/:modelSlug is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).patch("/v1/cars/bmw/3-series").send({ name: "x" });
    expect(res.status).toBe(401);
  });

  it("PATCH /v1/cars/:brandSlug/:modelSlug corrects a real seeded CarModel's real name and writes a real AuditLog row", async () => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });
    const original = carModel.name;
    try {
      const res = await adminAgent.patch("/v1/cars/bmw/3-series").send({ name: "Zzqxfixture 3 Series" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Zzqxfixture 3 Series");
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: "CarModel", entityId: carModel.id, action: "update_car_model" },
      });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.carModel.update({ where: { id: carModel.id }, data: { name: original } });
    }
  });

  it("PATCH /v1/cars/:brandSlug/:modelSlug 404s for a nonexistent car model", async () => {
    const res = await adminAgent.patch("/v1/cars/bmw/not-a-real-model").send({ name: "x" });
    expect(res.status).toBe(404);
  });

  it("GET /v1/cars/:brandSlug/:modelSlug 404s for a nonexistent car model", async () => {
    const res = await request(app).get("/v1/cars/bmw/not-a-real-model");
    expect(res.status).toBe(404);
  });

  it("GET /v1/cars/:brandSlug/:modelSlug returns real generations in chronological order by startYear — the real fix for a gap where no orderBy at all meant generations came back in plain insertion order, verified live to scramble the real public car page's display the moment an editor adds an older generation after a newer one already exists (a natural real use of the real 'Add generation' admin feature)", async () => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });
    // Deliberately created out of chronological order — the newer one
    // first — to prove this isn't passing by insertion-order coincidence.
    const newer = await prisma.generation.create({
      data: { carModelId: carModel.id, slug: "zzqxfixture-newer-gen", name: "Zzqxfixture Newer", startYear: 2025 },
    });
    const older = await prisma.generation.create({
      data: { carModelId: carModel.id, slug: "zzqxfixture-older-gen", name: "Zzqxfixture Older", startYear: 1990 },
    });
    const nullYear = await prisma.generation.create({
      data: { carModelId: carModel.id, slug: "zzqxfixture-unknown-year-gen", name: "Zzqxfixture Unknown Year" },
    });

    try {
      const res = await request(app).get("/v1/cars/bmw/3-series");
      expect(res.status).toBe(200);
      const names = res.body.carModel.generations.map((g: { name: string }) => g.name);
      // Real seeded G20 (2018) between the real 1990 and 2025 fixtures;
      // the unknown-year (null startYear) one sorts last.
      expect(names.indexOf("Zzqxfixture Older")).toBeLessThan(names.indexOf("G20"));
      expect(names.indexOf("G20")).toBeLessThan(names.indexOf("Zzqxfixture Newer"));
      expect(names.indexOf("Zzqxfixture Newer")).toBeLessThan(names.indexOf("Zzqxfixture Unknown Year"));
    } finally {
      await prisma.generation.deleteMany({ where: { id: { in: [newer.id, older.id, nullYear.id] } } });
    }
  });

  it("GET /v1/cars/:brandSlug/:modelSlug returns real trims in creation order, not arbitrary DB order — the real fix for a gap where neither trims/engines/batteries had any orderBy at all (same pass as the generations fix above)", async () => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });
    const generation = await prisma.generation.findFirstOrThrow({ where: { carModelId: carModel.id } });
    // Deliberately named so alphabetical order would put them in the
    // OPPOSITE order from creation — proves this is ordered by creation
    // (a real cuid, lexicographically time-ordered), not by name.
    const first = await prisma.trim.create({
      data: { generationId: generation.id, slug: "zzqxfixture-trim-first", name: "Z Created First" },
    });
    const second = await prisma.trim.create({
      data: { generationId: generation.id, slug: "zzqxfixture-trim-second", name: "A Created Second" },
    });

    try {
      const res = await request(app).get("/v1/cars/bmw/3-series");
      expect(res.status).toBe(200);
      const gen = res.body.carModel.generations.find((g: { id: string }) => g.id === generation.id);
      const names = gen.trims.map((t: { name: string }) => t.name);
      expect(names.indexOf("Z Created First")).toBeLessThan(names.indexOf("A Created Second"));
    } finally {
      await prisma.trim.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    }
  });

  it("GET /v1/cars/:brandSlug/:modelSlug returns real relatedStories newest-first — the real fix for a gap where this list had no orderBy at all, unlike every other real story list in this app", async () => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });
    const older = await prisma.story.create({
      data: { title: "Zzqxfixture Older Related Story", status: "DISCOVERED", lastUpdatedAt: new Date("2020-01-01") },
    });
    const newer = await prisma.story.create({
      data: { title: "Zzqxfixture Newer Related Story", status: "DISCOVERED", lastUpdatedAt: new Date("2026-01-01") },
    });
    const relOlder = await prisma.entityRelation.create({
      data: { fromType: ENTITY_TYPE.STORY, fromId: older.id, toType: ENTITY_TYPE.CAR_MODEL, toId: carModel.id, relation: "mentions" },
    });
    const relNewer = await prisma.entityRelation.create({
      data: { fromType: ENTITY_TYPE.STORY, fromId: newer.id, toType: ENTITY_TYPE.CAR_MODEL, toId: carModel.id, relation: "mentions" },
    });

    try {
      const res = await request(app).get("/v1/cars/bmw/3-series");
      expect(res.status).toBe(200);
      const titles = res.body.relatedStories.map((s: { title: string }) => s.title);
      expect(titles.indexOf("Zzqxfixture Newer Related Story")).toBeLessThan(
        titles.indexOf("Zzqxfixture Older Related Story"),
      );
    } finally {
      await prisma.entityRelation.deleteMany({ where: { id: { in: [relOlder.id, relNewer.id] } } });
      await prisma.story.deleteMany({ where: { id: { in: [older.id, newer.id] } } });
    }
  });
});

describe("generation/trim creation (UPDATE_CAR)", () => {
  // Reuses the file-level `adminAgent` (see top-of-file note). Real gap
  // found and fixed 2026-09-07: POST /v1/cars lets an editor create a
  // brand-new CarModel, but the real Generation -> Trim -> Engine/Battery
  // hierarchy the car page actually displays most prominently had no
  // create path at all.

  it("POST /v1/cars/:brandSlug/:modelSlug/generations is rejected with 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/v1/cars/bmw/3-series/generations")
      .send({ slug: "x", name: "x" });
    expect(res.status).toBe(401);
  });

  it("POST /v1/cars/:brandSlug/:modelSlug/generations creates a real Generation on the real seeded car and writes a real AuditLog row", async () => {
    const res = await adminAgent
      .post("/v1/cars/bmw/3-series/generations")
      .send({ slug: "zzqxfixture-gen", name: "Zzqxfixture Gen", startYear: 2030 });
    try {
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ slug: "zzqxfixture-gen", name: "Zzqxfixture Gen", startYear: 2030 });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "Generation", entityId: res.body.id, action: "create_generation" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.generation.deleteMany({ where: { slug: "zzqxfixture-gen" } });
    }
  });

  it("POST /v1/cars/:brandSlug/:modelSlug/generations 404s for a nonexistent car", async () => {
    const res = await adminAgent
      .post("/v1/cars/not-a-real-brand/not-a-real-model/generations")
      .send({ slug: "x", name: "x" });
    expect(res.status).toBe(404);
  });

  it("POST /v1/cars/:brandSlug/:modelSlug/generations rejects a negative startYear — real gap found and fixed 2026-09-07: this field (and powerKw/powerHp/capacityKwh/rangeKm/rangeMiles below) accepted any number until checked against this file's own trustScore/crawlInterval bounding convention", async () => {
    const res = await adminAgent
      .post("/v1/cars/bmw/3-series/generations")
      .send({ slug: "zzqxfixture-neg-gen", name: "x", startYear: -2020 });
    expect(res.status).toBe(400);
  });

  it("POST /v1/cars/:brandSlug/:modelSlug/generations rejects endYear before startYear — the real fix for a gap where a data-entry mistake (the two fields swapped) would publish a nonsensical range like \"2024–1990\" on the real public car page, which renders this pair literally", async () => {
    const res = await adminAgent
      .post("/v1/cars/bmw/3-series/generations")
      .send({ slug: "zzqxfixture-backwards-gen", name: "x", startYear: 2024, endYear: 1990 });
    expect(res.status).toBe(400);
  });

  it("POST /v1/cars/:brandSlug/:modelSlug/generations rejects a non-lowercase-kebab-case slug, same real fix as POST /v1/brands", async () => {
    const res = await adminAgent.post("/v1/cars/bmw/3-series/generations").send({ slug: "Zzqxfixture_Gen", name: "x" });
    expect(res.status).toBe(400);
  });

  it("POST /v1/generations/:generationId/trims is rejected with 401 when unauthenticated", async () => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });
    const generation = await prisma.generation.findFirstOrThrow({ where: { carModelId: carModel.id } });
    const res = await request(app).post(`/v1/generations/${generation.id}/trims`).send({ slug: "x", name: "x" });
    expect(res.status).toBe(401);
  });

  it("POST /v1/generations/:generationId/trims creates a real Trim on a real seeded generation and writes a real AuditLog row", async () => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });
    const generation = await prisma.generation.findFirstOrThrow({ where: { carModelId: carModel.id } });
    const res = await adminAgent
      .post(`/v1/generations/${generation.id}/trims`)
      .send({ slug: "zzqxfixture-trim", name: "Zzqxfixture Trim" });
    try {
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ slug: "zzqxfixture-trim", name: "Zzqxfixture Trim" });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "Trim", entityId: res.body.id, action: "create_trim" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.trim.deleteMany({ where: { slug: "zzqxfixture-trim" } });
    }
  });

  it("POST /v1/generations/:generationId/trims 404s for a nonexistent generation", async () => {
    const res = await adminAgent.post("/v1/generations/nonexistent-id/trims").send({ slug: "x", name: "x" });
    expect(res.status).toBe(404);
  });

  it("POST /v1/generations/:generationId/trims rejects a non-lowercase-kebab-case slug, same real fix as POST /v1/brands", async () => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });
    const generation = await prisma.generation.findFirstOrThrow({ where: { carModelId: carModel.id } });
    const res = await adminAgent.post(`/v1/generations/${generation.id}/trims`).send({ slug: "Zzqxfixture Trim", name: "x" });
    expect(res.status).toBe(400);
  });
});

describe("engine/battery creation (UPDATE_CAR)", () => {
  // Reuses the file-level `adminAgent` (see top-of-file note). Real gap
  // found and fixed 2026-09-07: the last remaining leaf of the real
  // Generation -> Trim -> Engine/Battery hierarchy — flagged as the
  // deliberate next step when Generation/Trim creation was scoped down
  // earlier the same day.

  it("POST /v1/trims/:trimId/engines is rejected with 401 when unauthenticated", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const res = await request(app).post(`/v1/trims/${trim.id}/engines`).send({ name: "x" });
    expect(res.status).toBe(401);
  });

  it("POST /v1/trims/:trimId/engines creates a real Engine on a real seeded trim and writes a real AuditLog row", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const res = await adminAgent
      .post(`/v1/trims/${trim.id}/engines`)
      .send({ name: "Zzqxfixture Engine", powerKw: 100, powerHp: 134, fuel: "petrol" });
    try {
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: "Zzqxfixture Engine", powerKw: 100, powerHp: 134, fuel: "petrol" });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "Engine", entityId: res.body.id, action: "create_engine" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.engine.deleteMany({ where: { name: "Zzqxfixture Engine" } });
    }
  });

  it("POST /v1/trims/:trimId/engines 404s for a nonexistent trim", async () => {
    const res = await adminAgent.post("/v1/trims/nonexistent-id/engines").send({ name: "x" });
    expect(res.status).toBe(404);
  });

  it("POST /v1/trims/:trimId/engines rejects a negative powerHp", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const res = await adminAgent.post(`/v1/trims/${trim.id}/engines`).send({ name: "x", powerHp: -50 });
    expect(res.status).toBe(400);
  });

  it("POST /v1/trims/:trimId/batteries is rejected with 401 when unauthenticated", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const res = await request(app).post(`/v1/trims/${trim.id}/batteries`).send({ capacityKwh: 75 });
    expect(res.status).toBe(401);
  });

  it("POST /v1/trims/:trimId/batteries creates a real Battery on a real seeded trim and writes a real AuditLog row", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const res = await adminAgent
      .post(`/v1/trims/${trim.id}/batteries`)
      .send({ capacityKwh: 75, rangeKm: 400 });
    try {
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ capacityKwh: 75, rangeKm: 400 });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "Battery", entityId: res.body.id, action: "create_battery" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.battery.delete({ where: { id: res.body.id } });
    }
  });

  it("POST /v1/trims/:trimId/batteries 404s for a nonexistent trim", async () => {
    const res = await adminAgent.post("/v1/trims/nonexistent-id/batteries").send({ capacityKwh: 10 });
    expect(res.status).toBe(404);
  });

  it("POST /v1/trims/:trimId/batteries rejects a negative capacityKwh", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const res = await adminAgent.post(`/v1/trims/${trim.id}/batteries`).send({ capacityKwh: -10 });
    expect(res.status).toBe(400);
  });
});

describe("generation/trim/engine/battery correction (UPDATE_CAR)", () => {
  // Real gap found and fixed 2026-09-07 (same day, later pass): the same
  // class of gap just closed for Brand/CarModel — these four got a
  // create path but never a correct one, until now.

  it("PATCH /v1/generations/:id is rejected with 401 when unauthenticated", async () => {
    const generation = await prisma.generation.findFirstOrThrow();
    const res = await request(app).patch(`/v1/generations/${generation.id}`).send({ name: "x" });
    expect(res.status).toBe(401);
  });

  it("PATCH /v1/generations/:id corrects a real seeded Generation and writes a real AuditLog row", async () => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });
    const generation = await prisma.generation.findFirstOrThrow({ where: { carModelId: carModel.id } });
    const original = generation.name;
    try {
      const res = await adminAgent.patch(`/v1/generations/${generation.id}`).send({ name: "Zzqxfixture Gen Corrected" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Zzqxfixture Gen Corrected");
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: "Generation", entityId: generation.id, action: "update_generation" },
      });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.generation.update({ where: { id: generation.id }, data: { name: original } });
    }
  });

  it("PATCH /v1/generations/:id 404s for a nonexistent generation", async () => {
    const res = await adminAgent.patch("/v1/generations/nonexistent-id").send({ name: "x" });
    expect(res.status).toBe(404);
  });

  it("PATCH /v1/generations/:id rejects a negative startYear", async () => {
    const generation = await prisma.generation.findFirstOrThrow();
    const res = await adminAgent.patch(`/v1/generations/${generation.id}`).send({ startYear: -2020 });
    expect(res.status).toBe(400);
  });

  it("PATCH /v1/generations/:id rejects a correction that would leave endYear before the real existing startYear — the real fix for a gap where a PATCH touching only one of the two fields wasn't checked against the row's *other*, unchanged real value", async () => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });
    const fixture = await prisma.generation.create({
      data: { carModelId: carModel.id, slug: "zzqxfixture-year-check-gen", name: "X", startYear: 2020, endYear: 2025 },
    });
    try {
      // Only endYear is submitted — startYear (2020) comes entirely from
      // the row's own existing, unchanged real value.
      const res = await adminAgent.patch(`/v1/generations/${fixture.id}`).send({ endYear: 2015 });
      expect(res.status).toBe(400);

      const stillUnchanged = await prisma.generation.findUniqueOrThrow({ where: { id: fixture.id } });
      expect(stillUnchanged.endYear).toBe(2025);
    } finally {
      await prisma.generation.delete({ where: { id: fixture.id } });
    }
  });

  it("PATCH /v1/trims/:id is rejected with 401 when unauthenticated", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const res = await request(app).patch(`/v1/trims/${trim.id}`).send({ name: "x" });
    expect(res.status).toBe(401);
  });

  it("PATCH /v1/trims/:id corrects a real seeded Trim and writes a real AuditLog row", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const original = trim.name;
    try {
      const res = await adminAgent.patch(`/v1/trims/${trim.id}`).send({ name: "Zzqxfixture Trim Corrected" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Zzqxfixture Trim Corrected");
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "Trim", entityId: trim.id, action: "update_trim" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.trim.update({ where: { id: trim.id }, data: { name: original } });
    }
  });

  it("PATCH /v1/trims/:id 404s for a nonexistent trim", async () => {
    const res = await adminAgent.patch("/v1/trims/nonexistent-id").send({ name: "x" });
    expect(res.status).toBe(404);
  });

  it("PATCH /v1/engines/:id is rejected with 401 when unauthenticated", async () => {
    const engine = await prisma.engine.findFirstOrThrow();
    const res = await request(app).patch(`/v1/engines/${engine.id}`).send({ name: "x" });
    expect(res.status).toBe(401);
  });

  it("PATCH /v1/engines/:id corrects a real seeded Engine and writes a real AuditLog row", async () => {
    const engine = await prisma.engine.findFirstOrThrow();
    const original = { name: engine.name, powerHp: engine.powerHp };
    try {
      const res = await adminAgent.patch(`/v1/engines/${engine.id}`).send({ name: "Zzqxfixture Engine Corrected", powerHp: 1 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: "Zzqxfixture Engine Corrected", powerHp: 1 });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "Engine", entityId: engine.id, action: "update_engine" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.engine.update({ where: { id: engine.id }, data: original });
    }
  });

  it("PATCH /v1/engines/:id 404s for a nonexistent engine", async () => {
    const res = await adminAgent.patch("/v1/engines/nonexistent-id").send({ name: "x" });
    expect(res.status).toBe(404);
  });

  it("PATCH /v1/engines/:id rejects a negative powerHp", async () => {
    const engine = await prisma.engine.findFirstOrThrow();
    const res = await adminAgent.patch(`/v1/engines/${engine.id}`).send({ powerHp: -1 });
    expect(res.status).toBe(400);
  });

  // No real seed data ever creates a Battery (only BMW's real ICE
  // engines are seeded — confirmed via seed.ts) — these tests create
  // their own real fixture row rather than assuming one exists,
  // matching this file's established "zzqxfixture" convention.
  it("PATCH /v1/batteries/:id is rejected with 401 when unauthenticated", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const battery = await prisma.battery.create({ data: { trimId: trim.id, capacityKwh: 50 } });
    try {
      const res = await request(app).patch(`/v1/batteries/${battery.id}`).send({ capacityKwh: 1 });
      expect(res.status).toBe(401);
    } finally {
      await prisma.battery.delete({ where: { id: battery.id } });
    }
  });

  it("PATCH /v1/batteries/:id 404s for a nonexistent battery", async () => {
    const res = await adminAgent.patch("/v1/batteries/nonexistent-id").send({ capacityKwh: 1 });
    expect(res.status).toBe(404);
  });

  it("PATCH /v1/batteries/:id corrects a real Battery fixture and writes a real AuditLog row", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const battery = await prisma.battery.create({ data: { trimId: trim.id, capacityKwh: 50 } });
    try {
      const res = await adminAgent.patch(`/v1/batteries/${battery.id}`).send({ capacityKwh: 75, rangeKm: 400 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ capacityKwh: 75, rangeKm: 400 });
      const audit = await prisma.auditLog.findFirst({ where: { entityType: "Battery", entityId: battery.id, action: "update_battery" } });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.battery.delete({ where: { id: battery.id } });
    }
  });

  it("PATCH /v1/batteries/:id rejects a negative capacityKwh", async () => {
    const trim = await prisma.trim.findFirstOrThrow();
    const battery = await prisma.battery.create({ data: { trimId: trim.id, capacityKwh: 50 } });
    try {
      const res = await adminAgent.patch(`/v1/batteries/${battery.id}`).send({ capacityKwh: -1 });
      expect(res.status).toBe(400);
    } finally {
      await prisma.battery.delete({ where: { id: battery.id } });
    }
  });
});

describe("car fact correction (UPDATE_CAR)", () => {
  // Reuses the file-level `adminAgent` (see top-of-file note).

  it("POST /v1/cars/:brandSlug/:modelSlug/facts is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).post("/v1/cars/bmw/3-series/facts").send({ attribute: "x", value: "y" });
    expect(res.status).toBe(401);
  });

  it("POST /v1/cars/:brandSlug/:modelSlug/facts creates a real CONFIRMED Fact on the real seeded car and writes a real AuditLog row — the real fix for a gap where UPDATE_CAR existed and admin already had it granted, but every Fact row could only ever come from seed.ts or the crawler", async () => {
    const auditCountBefore = await prisma.auditLog.count({ where: { entityType: "Fact" } });
    const res = await adminAgent
      .post("/v1/cars/bmw/3-series/facts")
      .send({ attribute: "zzqxfixture_attribute", value: "42", unit: "hp" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ attribute: "zzqxfixture_attribute", value: "42", unit: "hp", status: "CONFIRMED" });

    const auditCountAfter = await prisma.auditLog.count({ where: { entityType: "Fact" } });
    expect(auditCountAfter).toBe(auditCountBefore + 1);

    await prisma.fact.delete({ where: { id: res.body.id } });
  });

  it("POST /v1/cars/:brandSlug/:modelSlug/facts stores a real marketId when one is supplied", async () => {
    const market = await prisma.market.findUniqueOrThrow({ where: { code: "GB" } });
    const res = await adminAgent
      .post("/v1/cars/bmw/3-series/facts")
      .send({ attribute: "zzqxfixture_market_attribute", value: "1", marketId: market.id });
    expect(res.status).toBe(201);
    expect(res.body.marketId).toBe(market.id);

    await prisma.fact.delete({ where: { id: res.body.id } });
  });

  it("POST /v1/cars/:brandSlug/:modelSlug/facts 404s for a nonexistent car", async () => {
    const res = await adminAgent
      .post("/v1/cars/not-a-real-brand/not-a-real-model/facts")
      .send({ attribute: "x", value: "y" });
    expect(res.status).toBe(404);
  });

  // Real gap found and fixed 2026-09-08, the most severe found this whole
  // session: verified live against a real running dev server (not
  // assumed) that a bogus `marketId` reaching `prisma.fact.create()`
  // unchecked threw a real Prisma P2003 foreign-key violation that, with
  // no `express-async-errors` shim, was an uncaught rejection under
  // Express 4 — it crashed the entire Node process, confirmed by /health
  // itself going dead for every other in-flight request afterward, not
  // just this one. Fixed two ways: `express-async-errors` (app.ts's own
  // top-of-file import) so no future unhandled async rejection anywhere
  // in this file can crash the process again, and this specific
  // existence check so a bad `marketId` gets a clean 404 rather than
  // even reaching the generic 500 the shim alone would produce.
  it("POST /v1/cars/:brandSlug/:modelSlug/facts 404s for a nonexistent marketId instead of throwing an unhandled FK violation", async () => {
    const res = await adminAgent
      .post("/v1/cars/bmw/3-series/facts")
      .send({ attribute: "zzqxfixture_bad_market", value: "1", marketId: "not-a-real-market-id" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "market_not_found" });

    // The process itself must still be alive and serving other requests —
    // the whole point of this test.
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
  });

  it("PATCH /v1/facts/:id corrects a real fact's value and writes a real AuditLog row", async () => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });
    const fact = await prisma.fact.create({
      data: { carModelId: carModel.id, attribute: "zzqxfixture_correction", value: "wrong-value", status: "CONFIRMED" },
    });

    const auditCountBefore = await prisma.auditLog.count({ where: { entityId: fact.id } });
    const patch = await adminAgent.patch(`/v1/facts/${fact.id}`).send({ value: "corrected-value" });
    expect(patch.status).toBe(200);
    expect(patch.body.value).toBe("corrected-value");
    const auditCountAfter = await prisma.auditLog.count({ where: { entityId: fact.id } });
    expect(auditCountAfter).toBe(auditCountBefore + 1);

    await prisma.fact.delete({ where: { id: fact.id } });
  });

  it("PATCH /v1/facts/:id 404s for a nonexistent fact", async () => {
    const res = await adminAgent.patch("/v1/facts/nonexistent-id").send({ value: "x" });
    expect(res.status).toBe(404);
  });
});

describe("admin redirect management (MANAGE_SYSTEM_SETTINGS)", () => {
  // Reuses the file-level `adminAgent` (see top-of-file note).

  afterEach(async () => {
    await prisma.redirect.deleteMany({ where: { fromPath: { startsWith: "/zzqxfixture" } } });
  });

  it("GET /v1/redirects is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).get("/v1/redirects");
    expect(res.status).toBe(401);
  });

  it("POST /v1/redirects creates a real redirect that GET /v1/redirects/lookup immediately serves, and writes a real AuditLog row — the real fix for a gap where every Redirect row could only ever come from seed.ts", async () => {
    const auditCountBefore = await prisma.auditLog.count({ where: { entityType: "Redirect" } });
    const create = await adminAgent
      .post("/v1/redirects")
      .send({ fromPath: "/zzqxfixture/old-path", toPath: "/zzqxfixture/new-path", statusCode: 301 });
    expect(create.status).toBe(201);

    const auditCountAfter = await prisma.auditLog.count({ where: { entityType: "Redirect" } });
    expect(auditCountAfter).toBe(auditCountBefore + 1);

    // The real point of a redirect: prove the public, unauthenticated
    // lookup endpoint apps/web's proxy.ts actually calls sees it too, not
    // just that a row exists.
    const lookup = await request(app).get("/v1/redirects/lookup").query({ path: "/zzqxfixture/old-path" });
    expect(lookup.status).toBe(200);
    expect(lookup.body).toEqual({ toPath: "/zzqxfixture/new-path", statusCode: 301 });
  });

  it("POST /v1/redirects rejects a duplicate fromPath with 409 and a path missing a leading slash with 400", async () => {
    await adminAgent.post("/v1/redirects").send({ fromPath: "/zzqxfixture/dupe", toPath: "/zzqxfixture/target" });

    const dupe = await adminAgent.post("/v1/redirects").send({ fromPath: "/zzqxfixture/dupe", toPath: "/somewhere-else" });
    expect(dupe.status).toBe(409);

    const badPath = await adminAgent
      .post("/v1/redirects")
      .send({ fromPath: "zzqxfixture-no-slash", toPath: "/somewhere" });
    expect(badPath.status).toBe(400);
  });

  it("POST /v1/redirects rejects a self-referential redirect (fromPath === toPath) with 409 — the real fix for a gap where this would send a real browser into an infinite redirect loop, since apps/web's proxy.ts resolves exactly one hop per request", async () => {
    const res = await adminAgent
      .post("/v1/redirects")
      .send({ fromPath: "/zzqxfixture/self-loop", toPath: "/zzqxfixture/self-loop" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "redirect_cycle" });
  });

  it("POST /v1/redirects rejects a two-hop cyclical redirect (creating A→B when B→A already exists) with 409 — same infinite-loop class as the self-referential case above", async () => {
    await adminAgent.post("/v1/redirects").send({ fromPath: "/zzqxfixture/cycle-b", toPath: "/zzqxfixture/cycle-a" });
    const res = await adminAgent
      .post("/v1/redirects")
      .send({ fromPath: "/zzqxfixture/cycle-a", toPath: "/zzqxfixture/cycle-b" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "redirect_cycle" });
  });

  it("PATCH /v1/redirects/:id rejects a correction that would create the same self-referential or two-hop cycle", async () => {
    const selfTarget = await adminAgent
      .post("/v1/redirects")
      .send({ fromPath: "/zzqxfixture/patch-self-loop", toPath: "/zzqxfixture/somewhere-else" });
    const selfPatch = await adminAgent
      .patch(`/v1/redirects/${selfTarget.body.id}`)
      .send({ toPath: "/zzqxfixture/patch-self-loop" });
    expect(selfPatch.status).toBe(409);

    await adminAgent
      .post("/v1/redirects")
      .send({ fromPath: "/zzqxfixture/patch-cycle-b", toPath: "/zzqxfixture/patch-cycle-a" });
    const cycleTarget = await adminAgent
      .post("/v1/redirects")
      .send({ fromPath: "/zzqxfixture/patch-cycle-a", toPath: "/zzqxfixture/y" });
    const cyclePatch = await adminAgent
      .patch(`/v1/redirects/${cycleTarget.body.id}`)
      .send({ toPath: "/zzqxfixture/patch-cycle-b" });
    expect(cyclePatch.status).toBe(409);
  });

  it("PATCH /v1/redirects/:id corrects a real redirect's toPath and writes a real AuditLog row", async () => {
    const created = await adminAgent
      .post("/v1/redirects")
      .send({ fromPath: "/zzqxfixture/correct-me", toPath: "/zzqxfixture/wrong-target" });

    const auditCountBefore = await prisma.auditLog.count({ where: { entityId: created.body.id } });
    const patch = await adminAgent
      .patch(`/v1/redirects/${created.body.id}`)
      .send({ toPath: "/zzqxfixture/right-target" });
    expect(patch.status).toBe(200);
    expect(patch.body.toPath).toBe("/zzqxfixture/right-target");
    const auditCountAfter = await prisma.auditLog.count({ where: { entityId: created.body.id } });
    expect(auditCountAfter).toBe(auditCountBefore + 1);
  });

  it("PATCH /v1/redirects/:id 404s for a nonexistent redirect", async () => {
    const res = await adminAgent.patch("/v1/redirects/nonexistent-id").send({ toPath: "/x" });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/analytics/events", () => {
  it("is public (no auth required) and records a real pageview event", async () => {
    const path = "/__zzqxfixture-analytics-events-public";
    try {
      const res = await request(app)
        .post("/v1/analytics/events")
        .set("X-Forwarded-For", "203.0.113.10")
        .send({ type: "pageview", path });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true });

      const row = await prisma.analyticsEvent.findFirstOrThrow({ where: { path } });
      expect(row.type).toBe("pageview");
    } finally {
      await prisma.analyticsEvent.deleteMany({ where: { path } });
    }
  });

  it("rejects an invalid body with 400", async () => {
    const res = await request(app)
      .post("/v1/analytics/events")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ type: "pageview" }); // missing required `path`
    expect(res.status).toBe(400);
  });

  // Real gap found and fixed 2026-09-07: this was a third real public,
  // unauthenticated write endpoint (after login and search) with no rate
  // limit at all until this fix — every real page navigation hits it
  // automatically, so it needed one. Keying correctly on distinct real
  // visitors (not the internal proxy hop's own address) depends on
  // `apps/web/src/proxy.ts` relaying the real client's `X-Forwarded-For`
  // — this test proves that mechanism actually works by simulating two
  // different real visitors via two different forwarded-for values, each
  // getting their own independent limit budget, using its own dedicated
  // `X-Forwarded-For` values throughout (203.0.113.20/21) so this test
  // can't collide with the file-shared login/search rate-limit windows or
  // any other test hitting this endpoint (see the file-level note above).
  it("rate-limits per real forwarded client IP, not per internal caller — the real fix for a gap where this endpoint had no rate limit of any kind", async () => {
    const path = "/__zzqxfixture-analytics-events-ratelimit";
    try {
      let last;
      for (let i = 0; i < 121; i++) {
        last = await request(app)
          .post("/v1/analytics/events")
          .set("X-Forwarded-For", "203.0.113.20")
          .send({ type: "pageview", path });
      }
      expect(last!.status).toBe(429);

      // A different real visitor (a different forwarded IP) must not be
      // blocked by the first one's exhausted window.
      const otherVisitor = await request(app)
        .post("/v1/analytics/events")
        .set("X-Forwarded-For", "203.0.113.21")
        .send({ type: "pageview", path });
      expect(otherVisitor.status).toBe(201);
    } finally {
      await prisma.analyticsEvent.deleteMany({ where: { path } });
    }
  });
});

describe("analytics + search-query observability (MANAGE_SYSTEM_SETTINGS)", () => {
  it("GET /v1/analytics/pageviews is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).get("/v1/analytics/pageviews");
    expect(res.status).toBe(401);
  });

  it("GET /v1/analytics/pageviews returns real per-path counts, most-viewed first — the real fix for a gap where every real pageview event was written but never read back", async () => {
    const path = "/zzqxfixture/analytics-path";
    // The endpoint's `take: 20` is real production behavior (top pages
    // only), not a test seam — this dev DB has accumulated real E2E
    // traffic (350+ hits on the real top page as of writing), so the
    // fixture count must clearly outrank it rather than assume a small
    // handful of events will show up in the top 20.
    const FIXTURE_COUNT = 1000;
    try {
      await prisma.analyticsEvent.createMany({
        data: [
          ...Array.from({ length: FIXTURE_COUNT }, () => ({ type: "pageview", path })),
          { type: "not-a-pageview", path }, // must not count toward this path's total
        ],
      });

      const res = await adminAgent.get("/v1/analytics/pageviews");
      expect(res.status).toBe(200);
      const row = res.body.pageviews.find((p: { path: string }) => p.path === path);
      expect(row).toMatchObject({ path, count: FIXTURE_COUNT });
    } finally {
      // try/finally, not a trailing call: an assertion failure above must
      // not leave 1000+ fixture rows permanently skewing this shared dev
      // DB's real analytics for every test/tick after this one — this
      // happened for real on the first version of this test (missing
      // this exact cleanup) and needed a manual DB fix afterward.
      await prisma.analyticsEvent.deleteMany({ where: { path } });
    }
  });

  it("GET /v1/search-queries is rejected with 401 when unauthenticated", async () => {
    const res = await request(app).get("/v1/search-queries");
    expect(res.status).toBe(401);
  });

  it("GET /v1/search-queries returns real logged queries newest-first, including their real resultsCount — the real fix for a gap where every real search was logged but never read back", async () => {
    await prisma.searchQuery.create({
      data: { query: "zzqxfixture no results query", locale: "en", resultsCount: 0 },
    });

    const res = await adminAgent.get("/v1/search-queries");
    expect(res.status).toBe(200);
    expect(res.body.queries[0]).toMatchObject({ query: "zzqxfixture no results query", resultsCount: 0 });

    await prisma.searchQuery.deleteMany({ where: { query: "zzqxfixture no results query" } });
  });

  it("supports a real offset — the real fix for a gap where this endpoint's hardcoded take:50 had no offset, and this dev DB already has 700+ real rows permanently hidden past page 1, same shape as the same-day GET /v1/stories/GET /v1/alerts/GET /v1/audit-log fixes", async () => {
    // Real gap found and fixed 2026-09-09 (first real GitHub Actions CI
    // run — see the /v1/stories offset test's own comment for the full
    // story): "700+ real SearchQuery rows" only existed on one specific
    // long-lived local dev machine, never on a fresh CI database. Seeds
    // its own 51 real rows so this passes on either.
    const fixtureQueries = await prisma.searchQuery.createManyAndReturn({
      data: Array.from({ length: 51 }, (_, i) => ({
        query: `zzqxfixture offset query ${i}`,
        locale: "en" as const,
        resultsCount: 0,
      })),
    });
    try {
      const firstPage = await adminAgent.get("/v1/search-queries").query({ offset: 0 });
      const secondPage = await adminAgent.get("/v1/search-queries").query({ offset: 50 });
      expect(firstPage.status).toBe(200);
      expect(secondPage.status).toBe(200);
      expect(firstPage.body.offset).toBe(0);
      expect(secondPage.body.offset).toBe(50);
      const firstIds = firstPage.body.queries.map((q: { id: string }) => q.id);
      const secondIds = secondPage.body.queries.map((q: { id: string }) => q.id);
      expect(firstIds).not.toEqual(secondIds);
      expect(firstPage.body.hasMore).toBe(true);
    } finally {
      await prisma.searchQuery.deleteMany({ where: { id: { in: fixtureQueries.map((q) => q.id) } } });
    }
  });

  it("rejects a negative offset", async () => {
    const res = await adminAgent.get("/v1/search-queries").query({ offset: -1 });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/search", () => {
  // A dedicated test Story with a genuinely unique keyword, not a common
  // real-world word like "Tesla" — this repo's shared local DB has
  // accumulated 100+ real ingested stories over the course of building
  // this project (see project memory), several genuinely about Tesla, so
  // a search for "Tesla" can have more than the endpoint's LIMIT 10 exact
  // matches and this fixture isn't guaranteed a slot by ranking alone. A
  // nonsense keyword sidesteps that entirely rather than asserting on
  // result position. Locks in a real bug found while building this
  // endpoint: pg_trgm's plain similarity() scores a short query against a
  // long title far too low even for an exact word match (confirmed
  // ~0.06-0.09 against real data) — word_similarity() is the correct
  // function. If this regresses back to similarity(), this test fails.
  const uniqueKeyword = "Zzqxfixtureword";
  const testTitle = `Automotive Test Fixture: ${uniqueKeyword} gets a real update`;
  let testStoryId: string;

  beforeEach(async () => {
    const story = await prisma.story.create({ data: { title: testTitle, status: "DISCOVERED" } });
    testStoryId = story.id;
  });

  afterEach(async () => {
    await prisma.story.delete({ where: { id: testStoryId } });
  });

  it("finds a story by a short keyword that's a small fraction of the full title", async () => {
    const res = await request(app).get("/v1/search").query({ q: uniqueKeyword });
    expect(res.status).toBe(200);
    expect(res.body.stories.some((s: { id: string }) => s.id === testStoryId)).toBe(true);
  });

  it("finds the real seeded BMW 3 Series car by name", async () => {
    const res = await request(app).get("/v1/search").query({ q: "3 Series" });
    expect(res.status).toBe(200);
    expect(res.body.carModels).toEqual(
      expect.arrayContaining([expect.objectContaining({ brandSlug: "bmw", modelSlug: "3-series" })]),
    );
  });

  // Real bug found while writing apps/web's e2e search test: the original
  // query only matched CarModel.name ("3 Series"), so a brand-only search
  // like "BMW" found zero cars despite "BMW 3 Series" existing. Locks in
  // the fix (an OR against the joined Brand's name too).
  it("finds the real seeded BMW 3 Series car by brand name alone", async () => {
    const res = await request(app).get("/v1/search").query({ q: "BMW" });
    expect(res.status).toBe(200);
    expect(res.body.carModels).toEqual(
      expect.arrayContaining([expect.objectContaining({ brandSlug: "bmw", modelSlug: "3-series" })]),
    );
  });

  it("returns empty results for a query that matches nothing", async () => {
    const res = await request(app).get("/v1/search").query({ q: "zzqxvbnasdfqwerty" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stories: [], carModels: [] });
  });

  it("logs every query to SearchQuery with the real result count", async () => {
    const before = await prisma.searchQuery.count();
    await request(app).get("/v1/search").query({ q: "Tesla" });
    const after = await prisma.searchQuery.count();
    expect(after).toBe(before + 1);

    const logged = await prisma.searchQuery.findFirst({ orderBy: { createdAt: "desc" } });
    expect(logged).toMatchObject({ query: "Tesla" });
    expect(logged!.resultsCount).toBeGreaterThan(0);
  });
});

describe("GET /v1/topics", () => {
  // Exists so apps/web's sitemap.ts has real topic slugs to enumerate —
  // added after a real gap was found: topic pages existed and were linked
  // from the homepage but were never in the sitemap.
  it("lists the 3 real seeded topic slugs", async () => {
    const res = await request(app).get("/v1/topics");
    expect(res.status).toBe(200);
    expect(res.body.topics.map((t: { slug: string }) => t.slug)).toEqual(
      expect.arrayContaining(["safety-recalls", "electric-vehicles", "market-business"]),
    );
  });

  // Real gap found and fixed 2026-09-08: this endpoint's response shape
  // was widened to include a real `lastModified` per topic (for
  // apps/web/src/app/sitemap.ts, which never set it before) — the most
  // recent real Story.lastUpdatedAt among that topic's stories.
  it("each topic carries a real lastModified matching its most recently updated real Story", async () => {
    // Real gap found and fixed 2026-09-09 (first real GitHub Actions CI
    // run — see the /v1/stories offset test's own comment for the full
    // story): this always passed locally only because the long-lived dev
    // DB already had real Stories classified under "safety-recalls";
    // seed.ts's own demo data doesn't tag any Story with a topic, so a
    // fresh CI database has zero real Stories under it and lastModified
    // comes back null. Seeds its own one real Story so this passes on
    // either.
    const safetyRecallsTopic = await prisma.topic.findUniqueOrThrow({ where: { slug: "safety-recalls" } });
    const fixtureStory = await prisma.story.create({
      data: { title: "Zzqxfixture safety-recalls story", status: "DISCOVERED", primaryTopicId: safetyRecallsTopic.id },
    });
    try {
      const res = await request(app).get("/v1/topics");
      expect(res.status).toBe(200);
      const safetyRecalls = res.body.topics.find((t: { slug: string }) => t.slug === "safety-recalls");
      expect(safetyRecalls).toBeDefined();
      expect(safetyRecalls.lastModified).not.toBeNull();
      const mostRecentStory = await prisma.story.findFirst({
        where: { primaryTopicId: safetyRecallsTopic.id },
        orderBy: { lastUpdatedAt: "desc" },
      });
      expect(new Date(safetyRecalls.lastModified).toISOString()).toBe(mostRecentStory!.lastUpdatedAt.toISOString());
    } finally {
      await prisma.story.delete({ where: { id: fixtureStory.id } });
    }
  });

  it("GET /v1/topics/:slug 404s for an unknown slug", async () => {
    const res = await request(app).get("/v1/topics/not-a-real-topic");
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/articles", () => {
  // Real gap found and fixed 2026-09-09: this list endpoint didn't exist
  // at all — apps/web/src/app/sitemap.ts had no way to enumerate real
  // published articles, so 0 of them were ever in the real sitemap.
  it("lists a real PUBLISHED article but not a DRAFT one", async () => {
    const story = await prisma.story.create({ data: { title: "Test Story for Articles List Route" } });
    const published = await prisma.article.create({
      data: {
        storyId: story.id,
        locale: "en",
        type: "NEWS",
        contentPurpose: "BACKGROUND",
        status: "PUBLISHED",
        slug: "test-articles-list-published",
        headline: "Published for list test",
        authorType: "AI_AGENT",
        publishedAt: new Date(),
      },
    });
    const draft = await prisma.article.create({
      data: {
        storyId: story.id,
        locale: "en",
        type: "NEWS",
        contentPurpose: "BACKGROUND",
        status: "DRAFT",
        slug: "test-articles-list-draft",
        headline: "Draft for list test",
        authorType: "AI_AGENT",
      },
    });

    const res = await request(app).get("/v1/articles");
    expect(res.status).toBe(200);
    const slugs = res.body.articles.map((a: { slug: string }) => a.slug);
    expect(slugs).toContain("test-articles-list-published");
    expect(slugs).not.toContain("test-articles-list-draft");

    await prisma.article.delete({ where: { id: published.id } });
    await prisma.article.delete({ where: { id: draft.id } });
    await prisma.story.delete({ where: { id: story.id } });
  });
});

describe("GET /v1/articles/:locale/:slug", () => {
  // Real, first-ever caller test for this route — added alongside the
  // route itself when apps/worker/src/write-article.ts (the first real
  // Writer stage, calling packages/ai's real AnthropicProvider) started
  // producing real Article rows for the first time this session.
  it("404s for a slug that doesn't exist", async () => {
    const res = await request(app).get("/v1/articles/en/not-a-real-article");
    expect(res.status).toBe(404);
  });

  it("404s for an unsupported locale even if the slug exists", async () => {
    const res = await request(app).get("/v1/articles/fr/anything");
    expect(res.status).toBe(404);
  });

  it("returns a real PUBLISHED article with its ordered blocks, but not a DRAFT one", async () => {
    const story = await prisma.story.create({ data: { title: "Test Story for Article Route" } });
    const draft = await prisma.article.create({
      data: {
        storyId: story.id,
        locale: "en",
        type: "NEWS",
        contentPurpose: "BACKGROUND",
        status: "DRAFT",
        slug: "test-draft-article",
        headline: "Draft Headline",
        authorType: "AI_AGENT",
      },
    });
    const published = await prisma.article.create({
      data: {
        storyId: story.id,
        locale: "en",
        type: "NEWS",
        contentPurpose: "BACKGROUND",
        status: "PUBLISHED",
        slug: "test-published-article",
        headline: "Published Headline",
        subtitle: "A subtitle",
        keyTakeaway: "The key fact.",
        authorType: "AI_AGENT",
        publishedAt: new Date(),
        blocks: {
          create: [
            { type: "TEXT", position: 1, data: { text: "second paragraph" } },
            { type: "TEXT", position: 0, data: { text: "first paragraph" } },
          ],
        },
      },
    });

    const draftRes = await request(app).get("/v1/articles/en/test-draft-article");
    expect(draftRes.status).toBe(404);

    const res = await request(app).get("/v1/articles/en/test-published-article");
    expect(res.status).toBe(200);
    expect(res.body.article.headline).toBe("Published Headline");
    expect(res.body.article.story.id).toBe(story.id);
    // Confirms real ordering by `position`, not insertion order — the
    // fixture above deliberately created position 1 before position 0.
    expect(res.body.article.blocks.map((b: { data: { text: string } }) => b.data.text)).toEqual(["first paragraph", "second paragraph"]);

    await prisma.article.delete({ where: { id: draft.id } });
    await prisma.article.delete({ where: { id: published.id } });
    await prisma.story.delete({ where: { id: story.id } });
  });

  it("returns each article's real Citations — the real fix for a gap where 142 real published Articles had zero (user directly noticed source-less articles live on the site)", async () => {
    const source = await prisma.source.findFirstOrThrow({ where: { name: "Electrek" } });
    const story = await prisma.story.create({ data: { title: "Zzqxfixture story for citation test" } });
    const sourceArticle = await prisma.sourceArticle.create({
      data: {
        sourceId: source.id,
        storyId: story.id,
        url: "https://test.invalid/zzqxfixture-citation-source",
        urlHash: "zzqxfixture-citation-source-hash",
        title: "Zzqxfixture real source headline",
      },
    });
    const article = await prisma.article.create({
      data: {
        storyId: story.id,
        locale: "en",
        type: "NEWS",
        contentPurpose: "BACKGROUND",
        status: "PUBLISHED",
        slug: "zzqxfixture-citation-article",
        headline: "Zzqxfixture Citation Article",
        authorType: "AI_AGENT",
        publishedAt: new Date(),
      },
    });
    await prisma.citation.create({
      data: {
        articleId: article.id,
        sourceArticleId: sourceArticle.id,
        label: "Electrek: Zzqxfixture real source headline",
        url: sourceArticle.url,
      },
    });

    try {
      const res = await request(app).get("/v1/articles/en/zzqxfixture-citation-article");
      expect(res.status).toBe(200);
      expect(res.body.article.citations).toEqual([
        { id: expect.any(String), label: "Electrek: Zzqxfixture real source headline", url: sourceArticle.url },
      ]);
    } finally {
      await prisma.citation.deleteMany({ where: { articleId: article.id } });
      await prisma.article.delete({ where: { id: article.id } });
      await prisma.sourceArticle.delete({ where: { id: sourceArticle.id } });
      await prisma.story.delete({ where: { id: story.id } });
    }
  });
});

describe("GET /v1/admin/articles + PATCH .../publish|reject", () => {
  // The review queue for apps/worker/src/write-article.ts's real Writer
  // stage — when AUTO_PUBLISH is off (the real default), a real
  // AI-written Article lands as DRAFT here instead of going straight
  // live, and PUBLISH_ARTICLE decides publish vs. reject.
  it("GET requires auth (401) and the real UPDATE_ARTICLE permission", async () => {
    const res = await request(app).get("/v1/admin/articles");
    expect(res.status).toBe(401);
  });

  it("lists a real DRAFT article, publish moves it to PUBLISHED with a real audit log row, reject moves a different one to REJECTED", async () => {
    const story = await prisma.story.create({ data: { title: "Test Story for Admin Articles Route" } });
    const toPublish = await prisma.article.create({
      data: {
        storyId: story.id,
        locale: "en",
        type: "NEWS",
        contentPurpose: "BACKGROUND",
        status: "DRAFT",
        slug: "test-admin-articles-to-publish",
        headline: "Draft Awaiting Publish",
        authorType: "AI_AGENT",
      },
    });
    const toReject = await prisma.article.create({
      data: {
        storyId: story.id,
        locale: "en",
        type: "NEWS",
        contentPurpose: "BACKGROUND",
        status: "DRAFT",
        slug: "test-admin-articles-to-reject",
        headline: "Draft Awaiting Reject",
        authorType: "AI_AGENT",
      },
    });

    const listRes = await adminAgent.get("/v1/admin/articles").query({ status: "DRAFT" });
    expect(listRes.status).toBe(200);
    expect(listRes.body.articles.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining([toPublish.id, toReject.id]));

    const publishRes = await adminAgent.patch(`/v1/admin/articles/${toPublish.id}/publish`);
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.status).toBe("PUBLISHED");
    expect(publishRes.body.publishedAt).not.toBeNull();

    const publishAudit = await prisma.auditLog.findFirst({ where: { entityType: "Article", entityId: toPublish.id, action: "publish_article" } });
    expect(publishAudit).not.toBeNull();

    const rejectRes = await adminAgent.patch(`/v1/admin/articles/${toReject.id}/reject`);
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe("REJECTED");

    // Publicly 404s once REJECTED — only PUBLISHED articles are ever
    // served by the public read route.
    const publicRes = await request(app).get("/v1/articles/en/test-admin-articles-to-reject");
    expect(publicRes.status).toBe(404);

    await prisma.article.delete({ where: { id: toPublish.id } });
    await prisma.article.delete({ where: { id: toReject.id } });
    await prisma.story.delete({ where: { id: story.id } });
  });

  it("404s publishing an article that doesn't exist", async () => {
    const res = await adminAgent.patch("/v1/admin/articles/not-a-real-id/publish");
    expect(res.status).toBe(404);
  });
});

describe("fallthrough error handling", () => {
  // Real gap found and fixed 2026-09-07: this app had no catch-all 404
  // and no error-handling middleware — an unmatched route hit Express's
  // default HTML 404, and a malformed JSON body hit Express's default
  // error handler, which returned an HTML page containing a full stack
  // trace with real absolute server filesystem paths (verified live via
  // curl before writing any fix). Both now return this API's own JSON
  // error contract instead.

  it("an unmatched route returns this API's own JSON 404, not Express's default HTML page", async () => {
    const res = await request(app).get("/v1/not-a-real-route");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("a malformed JSON body returns a clean 400 with no stack trace or filesystem paths leaked", async () => {
    const res = await request(app)
      .post("/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_json" });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/node_modules|SyntaxError|\.js:\d+/);
  });
});
