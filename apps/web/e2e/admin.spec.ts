import { test, expect } from "@playwright/test";
import { prisma } from "@automotive/database";
import { adminAuthFile } from "./auth-file.js";

// Real admin auth flow against the real seeded dev admin
// (packages/database/src/seed.ts: admin@dev.local / dev-admin-password) —
// exercises the actual login form -> /api/admin/login proxy route ->
// apps/api's real session cookie, not a mocked auth state. The real
// login submission itself only happens once, in auth.setup.ts (see that
// file's comment) — every test below that needs an authenticated session
// loads the resulting cookie via `test.use({ storageState })` instead of
// resubmitting the form, so this suite doesn't re-hit apps/api's real
// (deliberately tight) login rate limit on every test.

test("logged-out visit to /admin redirects to the login page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("wrong password shows an error and does not navigate away", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill("admin@dev.local");
  await page.getByLabel("Password").fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login/);
});

test.describe("authenticated as the real seeded admin", () => {
  test.use({ storageState: adminAuthFile });

  test("reaches the dashboard with a real session, no login submission needed", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText("Logged in as Dev Admin")).toBeVisible();
  });

  test("Log out actually ends the real session — the real fix for a gap where POST /v1/auth/logout existed but no UI ever called it", async ({
    page,
  }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/admin\/login/);

    // Prove the session is genuinely gone, not just that the button
    // navigated somewhere — a stale/uncleared cookie would still let this
    // reach the dashboard.
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("dashboard shows the real seeded sources with trust scores", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
    await expect(page.getByText(/Electrek|InsideEVs|Motor1/).first()).toBeVisible();
    await expect(page.getByText(/trust \d+\/100/).first()).toBeVisible();
  });

  test("/admin/stories real pagination works end to end — the real fix for a gap where a fixed limit with no offset made every Story older than the first page permanently unreachable through the admin UI", async ({
    page,
  }) => {
    const totalReal = await prisma.story.count();
    // This dev DB has 150+ real ingested stories (well over one 50-item
    // page) — skip gracefully rather than fail if a future clean DB ever
    // has fewer, since this test's whole point is real pagination across
    // real accumulated data, not a fixture.
    test.skip(totalReal <= 50, "fewer than 50 real stories exist — nothing to paginate past yet");

    await page.goto("/admin/stories");
    await expect(page.getByText("showing 1")).toBeVisible();
    await expect(page.getByRole("link", { name: "Older →" })).toBeVisible();
    await expect(page.getByRole("link", { name: "← Newer" })).not.toBeVisible();

    await page.getByRole("link", { name: "Older →" }).click();
    await expect(page).toHaveURL(/offset=50/);
    await expect(page.getByText("showing 51")).toBeVisible();
    await expect(page.getByRole("link", { name: "← Newer" })).toBeVisible();

    await page.getByRole("link", { name: "← Newer" }).click();
    await expect(page).toHaveURL(/offset=0/);
    await expect(page.getByText("showing 1")).toBeVisible();
  });

  test("/admin/audit-log real pagination works end to end — the real fix for a gap where a hardcoded take:100 with no offset had already silently hidden 1,400+ real historical entries", async ({
    page,
  }) => {
    const totalReal = await prisma.auditLog.count();
    test.skip(totalReal <= 100, "fewer than 100 real audit-log rows exist — nothing to paginate past yet");

    await page.goto("/admin/audit-log");
    await expect(page.getByText("showing 1")).toBeVisible();
    await expect(page.getByRole("link", { name: "Older →" })).toBeVisible();
    await expect(page.getByRole("link", { name: "← Newer" })).not.toBeVisible();

    await page.getByRole("link", { name: "Older →" }).click();
    await expect(page).toHaveURL(/offset=100/);
    await expect(page.getByText("showing 101")).toBeVisible();
    await expect(page.getByRole("link", { name: "← Newer" })).toBeVisible();

    await page.getByRole("link", { name: "← Newer" }).click();
    await expect(page).toHaveURL(/offset=0/);
    await expect(page.getByText("showing 1")).toBeVisible();
  });

  test("deactivating a source and correcting its trust score works end to end through /admin — the real fix for a gap where PATCH /v1/sources/:id existed since early in the project but no UI ever called it", async ({
    page,
  }) => {
    const source = await prisma.source.create({
      data: {
        name: "Zzqxfixture E2E Source",
        url: "https://test.invalid/zzqxfixture-e2e-source",
        feedUrl: "https://test.invalid/zzqxfixture-e2e-source/feed.xml",
        type: "NEWS_MEDIA",
        tier: "UNVERIFIED",
        trustScore: 30,
        active: true,
      },
    });

    try {
      await page.goto("/admin");
      const row = page.locator("li.story-item", { hasText: "Zzqxfixture E2E Source" });
      await expect(row).toContainText("active");

      await row.getByRole("button", { name: "Deactivate" }).click();
      await expect(page).toHaveURL(/\/admin$/);
      const deactivatedRow = page.locator("li.story-item", { hasText: "Zzqxfixture E2E Source" });
      await expect(deactivatedRow).toContainText("inactive");
      await expect(deactivatedRow.getByRole("button", { name: "Activate" })).toBeVisible();

      await deactivatedRow.getByLabel("Trust").fill("85");
      await deactivatedRow.getByRole("button", { name: "Update" }).click();
      await expect(page).toHaveURL(/\/admin$/);
      const updatedRow = page.locator("li.story-item", { hasText: "Zzqxfixture E2E Source" });
      await expect(updatedRow).toContainText("trust 85/100");

      const fromDb = await prisma.source.findUniqueOrThrow({ where: { id: source.id } });
      expect(fromDb.active).toBe(false);
      expect(fromDb.trustScore).toBe(85);

      // Real gap found and fixed 2026-09-07: docs/editorial-system.md
      // documents SourceScoreEvent as how trustScore "moves" over time —
      // the correction above (30 -> 85) should now show up as real,
      // readable history, not just the new number.
      await expect(updatedRow.getByText("score history (1)")).toBeVisible();
      await updatedRow.getByText("score history (1)").click();
      await expect(updatedRow.getByText("Manually corrected by")).toBeVisible();
      const events = await prisma.sourceScoreEvent.findMany({ where: { sourceId: source.id } });
      expect(events).toMatchObject([{ delta: 55, newScore: 85 }]);
    } finally {
      // Cascade-deletes the real SourceScoreEvent row created above too
      // (SourceScoreEvent.source has onDelete: Cascade — verified in the
      // schema before relying on it here rather than assuming).
      await prisma.source.delete({ where: { id: source.id } });
    }
  });

  test("adding a real new source works end to end through /admin — the real fix for a gap where every real source could only ever come from seed.ts", async ({
    page,
  }) => {
    try {
      await page.goto("/admin");
      await page.getByLabel("New source name").fill("Zzqxfixture E2E Add Source");
      await page.getByLabel("New source URL").fill("https://test.invalid/zzqxfixture-e2e-add-source");
      await page.getByLabel("New source feed URL").fill("https://test.invalid/zzqxfixture-e2e-add-source/feed.xml");
      await page.getByLabel("New source type").selectOption("NEWS_MEDIA");
      await page.getByLabel("New source tier").selectOption("SPECIALIST");
      await page.getByRole("button", { name: "Add source" }).click();

      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByText("Zzqxfixture E2E Add Source")).toBeVisible();

      const fromDb = await prisma.source.findFirstOrThrow({
        where: { url: "https://test.invalid/zzqxfixture-e2e-add-source" },
      });
      expect(fromDb).toMatchObject({ name: "Zzqxfixture E2E Add Source", tier: "SPECIALIST", trustScore: 30 });
    } finally {
      await prisma.source.deleteMany({ where: { url: "https://test.invalid/zzqxfixture-e2e-add-source" } });
    }
  });

  test("adding a source with a URL that's already taken shows a real error instead of a silent failure", async ({ page }) => {
    const existing = await prisma.source.findFirstOrThrow();
    await page.goto("/admin");
    await page.getByLabel("New source name").fill("Zzqxfixture Dup");
    await page.getByLabel("New source URL").fill(existing.url);
    await page.getByLabel("New source type").selectOption("RSS");
    await page.getByRole("button", { name: "Add source" }).click();

    await expect(page).toHaveURL(/\/admin\?error=url_taken$/);
    await expect(page.getByText("A source with that URL already exists.")).toBeVisible();
  });

  test("session cookie carries across every admin page", async ({ page }) => {
    await page.goto("/admin/stories");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Stories/ })).toBeVisible();

    await page.goto("/admin/alerts");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    // Real state, not a fixture: assert whichever real state actually
    // holds (this dev DB currently has zero SystemAlert rows) rather than
    // hardcoding one, so this doesn't break the day a real alert exists.
    const alertsHeading = page.getByRole("heading", { name: /^System alerts/ });
    await expect(alertsHeading).toBeVisible();
    const hasAlerts = /\((\d+)\)/.exec((await alertsHeading.textContent()) ?? "")?.[1] !== "0";
    if (!hasAlerts) {
      await expect(page.getByText("No alerts — nothing has failed.")).toBeVisible();
    }

    await page.goto("/admin/audit-log");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Audit log/ })).toBeVisible();

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Users/ })).toBeVisible();

    await page.goto("/admin/cars");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Cars/ })).toBeVisible();

    await page.goto("/admin/redirects");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Redirects/ })).toBeVisible();

    await page.goto("/admin/analytics");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Top pages/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Recent searches/ })).toBeVisible();
  });

  test("Resolve button marks a real alert resolved via the real API, end to end", async ({ page }) => {
    // Real fixture, not a mock: this dev DB has zero SystemAlert rows day
    // to day, so a genuine unresolved alert is created directly via
    // Prisma the same way analytics.spec.ts seeds its own fixture rows,
    // then driven entirely through the real UI -> the real
    // /api/admin/alerts/[id]/resolve proxy -> the real
    // PATCH /v1/alerts/:id/resolve.
    const alert = await prisma.systemAlert.create({
      data: { severity: "WARNING", source: "e2e-test", message: "zzqxfixture e2e resolvable alert" },
    });

    try {
      await page.goto("/admin/alerts");

      const row = page.locator("li.story-item", { hasText: "zzqxfixture e2e resolvable alert" });
      await expect(row).toContainText("unresolved");
      await row.getByRole("button", { name: "Resolve" }).click();

      await expect(page).toHaveURL(/\/admin\/alerts$/);
      // "unresolved" contains "resolved" as a substring, so the
      // meaningful assertion is the *absence* of "unresolved", not the
      // presence of "resolved" (which would be trivially true either way).
      const resolvedRow = page.locator("li.story-item", { hasText: "zzqxfixture e2e resolvable alert" });
      await expect(resolvedRow).not.toContainText("unresolved");
      await expect(resolvedRow.getByRole("button", { name: "Resolve" })).toHaveCount(0);

      const fromDb = await prisma.systemAlert.findUniqueOrThrow({ where: { id: alert.id } });
      expect(fromDb.resolved).toBe(true);
      expect(fromDb.resolvedAt).not.toBeNull();
    } finally {
      await prisma.systemAlert.delete({ where: { id: alert.id } });
    }
  });

  test("a real mutation shows up on /admin/audit-log, end to end", async ({ page }) => {
    // Same resolve-alert flow as the test above, but this time verifying
    // the *other* end of the gap fixed 2026-09-07: AuditLog rows have
    // been written on every admin mutation for a while, but nothing
    // could ever read them back until this page existed.
    const alert = await prisma.systemAlert.create({
      data: { severity: "WARNING", source: "e2e-test", message: "zzqxfixture audit-log-visible alert" },
    });

    try {
      await page.goto("/admin/alerts");
      await page
        .locator("li.story-item", { hasText: "zzqxfixture audit-log-visible alert" })
        .getByRole("button", { name: "Resolve" })
        .click();

      await page.goto("/admin/audit-log");
      const entry = page.locator("li.story-item", { hasText: `resolve_alert — SystemAlert ${alert.id}` });
      await expect(entry).toBeVisible();
      // Real gap found and fixed alongside this page: actorLabel used to
      // be the raw User.id (not human-readable at all) — now the actor's
      // email.
      await expect(entry).toContainText("admin@dev.local");
    } finally {
      await prisma.systemAlert.delete({ where: { id: alert.id } });
    }
  });

  test("creating and suspending a real user works end to end through /admin/users", async ({ page }) => {
    // Real gap found and fixed 2026-09-07: MANAGE_USERS existed and every
    // admin already had it granted, but seed.ts's single hardcoded admin
    // was the only User row that could ever exist — nothing could create
    // a second account. This drives the real form -> real POST
    // /v1/users -> real bcrypt hash -> real DB row, then the real
    // Suspend button.
    const email = "zzqxfixture-e2e-user@dev.local";

    try {
      await page.goto("/admin/users");

      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Name").fill("Fixture E2E User");
      await page.getByLabel("Password").fill("fixture-password-123");
      await page.getByLabel("Role").selectOption("editor");
      await page.getByRole("button", { name: "Create user" }).click();

      await expect(page).toHaveURL(/\/admin\/users$/);
      const row = page.locator("li.story-item", { hasText: email });
      await expect(row).toContainText("ACTIVE");
      await expect(row).toContainText("editor");

      await row.getByRole("button", { name: "Suspend" }).click();
      await expect(page).toHaveURL(/\/admin\/users$/);
      const suspendedRow = page.locator("li.story-item", { hasText: email });
      await expect(suspendedRow).toContainText("SUSPENDED");
      await expect(suspendedRow.getByRole("button", { name: "Activate" })).toBeVisible();
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  test("the logged-in admin never sees a Suspend button on their own row", async ({ page }) => {
    // Locks in the server-side self-suspend guard's UI counterpart: even
    // without the API guard, the button that would trigger it shouldn't
    // render for your own account.
    await page.goto("/admin/users");
    const ownRow = page.locator("li.story-item", { hasText: "admin@dev.local" });
    await expect(ownRow.getByRole("button", { name: "Suspend" })).toHaveCount(0);
  });

  test("adding and correcting a real car Fact works end to end through /admin/cars", async ({ page }) => {
    // Real gap found and fixed 2026-09-07: UPDATE_CAR existed and admin
    // already had it granted, but every Fact row could only ever come
    // from seed.ts or the crawler — this drives the real "Add fact" form
    // -> real POST /v1/cars/:brand/:model/facts -> a real DB row, then
    // the real per-fact "Update" form -> real PATCH /v1/facts/:id.
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });

    try {
      await page.goto("/admin/cars");

      await page.getByPlaceholder("attribute (e.g. price)").fill("zzqxfixture_e2e_attribute");
      await page.getByPlaceholder("value", { exact: true }).first().fill("100");
      await page.getByPlaceholder("unit", { exact: true }).last().fill("usd");
      // Real gap found and fixed 2026-09-07: POST .../facts accepted an
      // optional marketId since this endpoint was built, but the "Add
      // fact" form had no market picker at all — GET /v1/markets +
      // this <select> are the real fix.
      // Real gap found and fixed 2026-09-07: this form's aria-labels
      // weren't scoped per car model (unlike every other per-entity form
      // on this page) — harmless while only one real CarModel existed,
      // but a real ambiguity the moment a second one does (now possible
      // since this session's own Brand/CarModel creation feature).
      // Scoped explicitly here rather than relying on substring matching.
      await page.getByLabel("Market for new fact for BMW 3 Series").selectOption({ label: "United Kingdom (GB)" });
      await page.getByRole("button", { name: "Add fact" }).first().click();

      await expect(page).toHaveURL(/\/admin\/cars$/);
      const row = page.locator("li.story-item", { hasText: "zzqxfixture_e2e_attribute" });
      await expect(row.getByLabel("Value for zzqxfixture_e2e_attribute")).toHaveValue("100");
      await expect(row.getByText("(GB)")).toBeVisible();

      const created = await prisma.fact.findFirstOrThrow({
        where: { carModelId: carModel.id, attribute: "zzqxfixture_e2e_attribute" },
      });
      // Real test-quality gap found and fixed 2026-09-08: this only
      // checked SOME marketId was stored, not that it was the real GB
      // market actually selected above — the page's own "(GB)" display
      // check two lines up already proves the UI reflects a market, but
      // not that the CORRECT one made it all the way into the database
      // (a bug that stored the wrong market's id, or the first market in
      // some list, could still show "(GB)" if the display logic and the
      // storage logic diverged). Comparing against the real market row
      // directly closes that gap.
      const gbMarket = await prisma.market.findUniqueOrThrow({ where: { code: "GB" } });
      expect(created.marketId).toBe(gbMarket.id);

      await row.getByLabel("Value for zzqxfixture_e2e_attribute").fill("200");
      await row.getByRole("button", { name: "Update" }).click();

      await expect(page).toHaveURL(/\/admin\/cars$/);
      const updatedRow = page.locator("li.story-item", { hasText: "zzqxfixture_e2e_attribute" });
      await expect(updatedRow.getByLabel("Value for zzqxfixture_e2e_attribute")).toHaveValue("200");

      const fromDb = await prisma.fact.findFirstOrThrow({
        where: { carModelId: carModel.id, attribute: "zzqxfixture_e2e_attribute" },
      });
      expect(fromDb.value).toBe("200");
    } finally {
      await prisma.fact.deleteMany({ where: { carModelId: carModel.id, attribute: "zzqxfixture_e2e_attribute" } });
    }
  });

  test("adding a real new brand and car model works end to end through /admin/cars — the real fix for a gap where every real Brand/CarModel could only ever come from seed.ts", async ({
    page,
  }) => {
    try {
      await page.goto("/admin/cars");
      await page.getByLabel("New brand slug").fill("zzqxfixture-e2e-brand");
      await page.getByLabel("New brand name").fill("Zzqxfixture E2E Brand");
      await page.getByLabel("New brand country").fill("JP");
      await page.getByRole("button", { name: "Add brand" }).click();

      await expect(page).toHaveURL(/\/admin\/cars$/);
      await expect(page.getByLabel("Brand for new car model")).toContainText("Zzqxfixture E2E Brand");

      await page.getByLabel("Brand for new car model").selectOption({ label: "Zzqxfixture E2E Brand" });
      await page.getByLabel("New car model slug").fill("zzqxfixture-e2e-model");
      await page.getByLabel("New car model name").fill("Zzqxfixture E2E Model");
      await page.getByRole("button", { name: "Add car model" }).click();

      await expect(page).toHaveURL(/\/admin\/cars$/);
      await expect(page.getByText("Zzqxfixture E2E Brand Zzqxfixture E2E Model")).toBeVisible();

      const brand = await prisma.brand.findUniqueOrThrow({ where: { slug: "zzqxfixture-e2e-brand" } });
      expect(brand.country).toBe("JP");
      const carModel = await prisma.carModel.findUniqueOrThrow({
        where: { brandId_slug: { brandId: brand.id, slug: "zzqxfixture-e2e-model" } },
      });
      expect(carModel.name).toBe("Zzqxfixture E2E Model");

      // Real gap found and fixed 2026-09-07 (same day, later pass): every
      // other admin entity built today got both a create AND a correct
      // path — Brand/CarModel only ever got create, until now. Continues
      // the same flow on the brand/model just created above.
      await page
        .getByLabel(`Correct brand name for ${brand.name}`)
        .fill("Zzqxfixture E2E Brand Corrected");
      await page
        .locator("form", { has: page.getByLabel(`Correct brand name for ${brand.name}`) })
        .getByRole("button", { name: "Update brand" })
        .click();
      await expect(page).toHaveURL(/\/admin\/cars$/);
      // Scoped to the <h3> heading specifically — "Zzqxfixture E2E Brand
      // Corrected" also appears as a <select> option text in the "Add
      // car model" brand picker, which a plain getByText would also
      // match (a real strict-mode ambiguity caught by actually running
      // this, not assumed away).
      await expect(page.getByRole("heading", { name: "Zzqxfixture E2E Brand Corrected" })).toBeVisible();

      await page
        .getByLabel(`Correct model name for Zzqxfixture E2E Brand Corrected Zzqxfixture E2E Model`)
        .fill("Zzqxfixture E2E Model Corrected");
      await page
        .locator("form", {
          has: page.getByLabel("Correct model name for Zzqxfixture E2E Brand Corrected Zzqxfixture E2E Model"),
        })
        .getByRole("button", { name: "Update model" })
        .click();
      await expect(page).toHaveURL(/\/admin\/cars$/);
      await expect(page.getByText("Zzqxfixture E2E Model Corrected")).toBeVisible();

      const correctedBrand = await prisma.brand.findUniqueOrThrow({ where: { id: brand.id } });
      expect(correctedBrand.name).toBe("Zzqxfixture E2E Brand Corrected");
      const correctedCarModel = await prisma.carModel.findUniqueOrThrow({ where: { id: carModel.id } });
      expect(correctedCarModel.name).toBe("Zzqxfixture E2E Model Corrected");
    } finally {
      await prisma.carModel.deleteMany({ where: { slug: "zzqxfixture-e2e-model" } });
      await prisma.brand.deleteMany({ where: { slug: "zzqxfixture-e2e-brand" } });
    }
  });

  test("adding a real new generation and trim works end to end through /admin/cars — the real fix for a gap where the car page's own Generation/Trim/Engine hierarchy had no create path at all", async ({
    page,
  }) => {
    const carModel = await prisma.carModel.findFirstOrThrow({ where: { slug: "3-series" } });

    try {
      await page.goto("/admin/cars");
      await page.getByLabel("New generation slug for BMW 3 Series").fill("zzqxfixture-e2e-gen");
      await page.getByLabel("New generation name for BMW 3 Series").fill("Zzqxfixture E2E Gen");
      await page.getByLabel("New generation start year for BMW 3 Series").fill("2031");
      await page.getByRole("button", { name: "Add generation" }).click();

      await expect(page).toHaveURL(/\/admin\/cars$/);
      // The generation's name/startYear render as editable correction-
      // form <input> values now (added the same day, later pass), not
      // plain text, so getByText can't see them — assert via the real
      // input values instead. Labels are scoped by the full real
      // hierarchy path (another same-day pass, after finding the first
      // scoping attempt two passes ago never got propagated past the
      // top level) — "BMW 3 Series" throughout, since that's this
      // real seeded car's own carLabel.
      const genLabel = "BMW 3 Series Zzqxfixture E2E Gen";
      await expect(page.getByLabel(`Correct generation name for ${genLabel}`)).toHaveValue("Zzqxfixture E2E Gen");
      await expect(page.getByLabel(`Correct start year for ${genLabel}`)).toHaveValue("2031");

      const generation = await prisma.generation.findUniqueOrThrow({
        where: { carModelId_slug: { carModelId: carModel.id, slug: "zzqxfixture-e2e-gen" } },
      });

      await page.getByLabel(`New trim slug for ${genLabel}`).fill("zzqxfixture-e2e-trim");
      await page.getByLabel(`New trim name for ${genLabel}`).fill("Zzqxfixture E2E Trim");
      await page
        .locator("form", { has: page.getByLabel(`New trim slug for ${genLabel}`) })
        .getByRole("button", { name: "Add trim" })
        .click();

      await expect(page).toHaveURL(/\/admin\/cars$/);
      // Same reasoning as above — trim name is now a correction-form
      // input value, not plain text.
      const trimLabel = `${genLabel} Zzqxfixture E2E Trim`;
      await expect(page.getByLabel(`Correct trim name for ${trimLabel}`)).toHaveValue("Zzqxfixture E2E Trim");

      const trim = await prisma.trim.findUniqueOrThrow({
        where: { generationId_slug: { generationId: generation.id, slug: "zzqxfixture-e2e-trim" } },
      });
      expect(trim.name).toBe("Zzqxfixture E2E Trim");

      // Real gap found and fixed 2026-09-07 (same day, next pass): the
      // last leaves of this hierarchy — Engine/Battery — flagged as a
      // deliberate follow-up when Generation/Trim creation shipped, now
      // closed the same way. Continues the same flow on the trim just
      // created above rather than a wholly separate test.
      await page.getByLabel(`New engine name for ${trimLabel}`).fill("Zzqxfixture E2E Engine");
      await page.getByLabel(`New engine hp for ${trimLabel}`).fill("321");
      await page
        .locator("form", { has: page.getByLabel(`New engine name for ${trimLabel}`) })
        .getByRole("button", { name: "Add engine" })
        .click();

      await expect(page).toHaveURL(/\/admin\/cars$/);
      // Same reasoning as generation/trim above — engine name/power are
      // now correction-form input values, not plain text.
      const engineLabel = `${trimLabel} Zzqxfixture E2E Engine`;
      await expect(page.getByLabel(`Correct engine name for ${engineLabel}`)).toHaveValue("Zzqxfixture E2E Engine");
      await expect(page.getByLabel(`Correct power for ${engineLabel}`)).toHaveValue("321");

      const engine = await prisma.engine.findFirstOrThrow({ where: { trimId: trim.id } });
      expect(engine).toMatchObject({ name: "Zzqxfixture E2E Engine", powerHp: 321 });

      // Real gap found and fixed 2026-09-07 (same day, later pass): the
      // same class of gap just closed for Brand/CarModel — Generation/
      // Trim/Engine/Battery all got a create path but never a correct
      // one. Continues the same flow on the generation/trim/engine just
      // created above.
      await page.getByLabel(`Correct generation name for ${genLabel}`).fill("Zzqxfixture E2E Gen Corrected");
      await page
        .locator("form", { has: page.getByLabel(`Correct generation name for ${genLabel}`) })
        .getByRole("button", { name: "Update generation" })
        .click();
      await expect(page).toHaveURL(/\/admin\/cars$/);
      // The corrected name is also only an input value, not plain text
      // — and the aria-label itself is derived from the (now corrected)
      // name, so assert via the new label rather than the old one.
      const genLabelCorrected = "BMW 3 Series Zzqxfixture E2E Gen Corrected";
      await expect(page.getByLabel(`Correct generation name for ${genLabelCorrected}`)).toHaveValue(
        "Zzqxfixture E2E Gen Corrected",
      );

      // The trim's own label now reflects the just-corrected generation
      // name too, since it's derived fresh from the current page load.
      const trimLabelAfterGenCorrection = `${genLabelCorrected} Zzqxfixture E2E Trim`;
      await page
        .getByLabel(`Correct trim name for ${trimLabelAfterGenCorrection}`)
        .fill("Zzqxfixture E2E Trim Corrected");
      await page
        .locator("form", { has: page.getByLabel(`Correct trim name for ${trimLabelAfterGenCorrection}`) })
        .getByRole("button", { name: "Update trim" })
        .click();
      await expect(page).toHaveURL(/\/admin\/cars$/);
      await expect(
        page.getByLabel(`Correct trim name for ${genLabelCorrected} Zzqxfixture E2E Trim Corrected`),
      ).toHaveValue("Zzqxfixture E2E Trim Corrected");

      const correctedGeneration = await prisma.generation.findUniqueOrThrow({ where: { id: generation.id } });
      expect(correctedGeneration.name).toBe("Zzqxfixture E2E Gen Corrected");
      const correctedTrim = await prisma.trim.findUniqueOrThrow({ where: { id: trim.id } });
      expect(correctedTrim.name).toBe("Zzqxfixture E2E Trim Corrected");
    } finally {
      // No onDelete: Cascade anywhere in this chain (verified in the
      // schema, not assumed) — delete child-first or the FK blocks it.
      await prisma.engine.deleteMany({ where: { name: "Zzqxfixture E2E Engine" } });
      await prisma.trim.deleteMany({ where: { slug: "zzqxfixture-e2e-trim" } });
      await prisma.generation.deleteMany({ where: { slug: "zzqxfixture-e2e-gen" } });
    }
  });

  test("adding and correcting a real redirect works end to end through /admin/redirects", async ({ page }) => {
    // Real gap found and fixed 2026-09-07: every real Redirect row could
    // only ever come from seed.ts — this drives the real "Add redirect"
    // form -> real POST /v1/redirects -> a real DB row that GET
    // /v1/redirects/lookup (the endpoint apps/web's proxy.ts actually
    // calls on every request) immediately serves, then the real
    // per-redirect "Update" form -> real PATCH /v1/redirects/:id.
    const fromPath = "/zzqxfixture-e2e-old-path";

    try {
      await page.goto("/admin/redirects");

      await page.getByLabel("From path").fill(fromPath);
      await page.getByLabel("To path").fill("/zzqxfixture-e2e-new-path");
      await page.getByRole("button", { name: "Add redirect" }).click();

      await expect(page).toHaveURL(/\/admin\/redirects$/);
      const row = page.locator("li.story-item", { hasText: fromPath });
      await expect(row.getByLabel(`Destination for ${fromPath}`)).toHaveValue("/zzqxfixture-e2e-new-path");

      await row.getByLabel(`Destination for ${fromPath}`).fill("/zzqxfixture-e2e-corrected-path");
      await row.getByRole("button", { name: "Update" }).click();

      await expect(page).toHaveURL(/\/admin\/redirects$/);
      const updatedRow = page.locator("li.story-item", { hasText: fromPath });
      await expect(updatedRow.getByLabel(`Destination for ${fromPath}`)).toHaveValue("/zzqxfixture-e2e-corrected-path");

      const fromDb = await prisma.redirect.findUniqueOrThrow({ where: { fromPath } });
      expect(fromDb.toPath).toBe("/zzqxfixture-e2e-corrected-path");
    } finally {
      await prisma.redirect.deleteMany({ where: { fromPath } });
    }
  });

  test("correcting a redirect into a real cycle shows a real error through the actual admin UI, not a silent no-op — the real fix for a gap where the route handler discarded the API's real 409 and always redirected as if it succeeded", async ({
    page,
  }) => {
    // Real gap found and fixed 2026-09-07: apps/api's own redirect-cycle
    // guard (added earlier the same day) already rejected this
    // server-side with a real 409 — but
    // apps/web/src/app/api/admin/redirects/[id]/route.ts discarded that
    // response entirely and always redirected back to /admin/redirects
    // as if the correction had succeeded, so a real admin using this
    // real page saw no error at all and no way to know why their edit
    // silently didn't apply.
    const fromPath = "/zzqxfixture-e2e-cycle-guard";
    const toPath = "/zzqxfixture-e2e-cycle-guard-target";

    try {
      const created = await prisma.redirect.create({ data: { fromPath, toPath, statusCode: 301 } });

      await page.goto("/admin/redirects");
      const row = page.locator("li.story-item", { hasText: fromPath });
      // Correcting it to point at itself is the simplest real cycle.
      await row.getByLabel(`Destination for ${fromPath}`).fill(fromPath);
      await row.getByRole("button", { name: "Update" }).click();

      await expect(page).toHaveURL(/\/admin\/redirects\?error=redirect_cycle$/);
      await expect(page.getByText(/redirect loop/i)).toBeVisible();

      // The real DB row must be genuinely untouched, not just that the
      // page showed an error while the write silently went through anyway.
      const fromDb = await prisma.redirect.findUniqueOrThrow({ where: { id: created.id } });
      expect(fromDb.toPath).toBe(toPath);
    } finally {
      await prisma.redirect.deleteMany({ where: { fromPath } });
    }
  });

  test("/admin/analytics shows a real zero-result search flagged, end to end", async ({ page }) => {
    // Real gap found and fixed 2026-09-07: every real search has logged a
    // real SearchQuery row (with its actual result count) since that
    // feature shipped, but nothing could ever read the table back. The
    // most actionable real signal here is a zero-result search — this
    // locks in that it's visually flagged, not just listed the same as
    // every other query.
    const query = "zzqxfixture e2e zero result search";

    try {
      await prisma.searchQuery.create({ data: { query, locale: "en", resultsCount: 0 } });

      await page.goto("/admin/analytics");
      const row = page.locator("li.story-item", { hasText: query });
      await expect(row).toBeVisible();
      await expect(row.getByText("0 results")).toBeVisible();
    } finally {
      await prisma.searchQuery.deleteMany({ where: { query } });
    }
  });

  test("/admin/analytics real search pagination works end to end — the real fix for a gap where a hardcoded take:50 with no offset had already silently hidden 670+ real logged searches", async ({
    page,
  }) => {
    const totalReal = await prisma.searchQuery.count();
    test.skip(totalReal <= 50, "fewer than 50 real search-query rows exist — nothing to paginate past yet");

    await page.goto("/admin/analytics");
    await expect(page.getByText("showing 1")).toBeVisible();
    await expect(page.getByRole("link", { name: "Older →" })).toBeVisible();
    await expect(page.getByRole("link", { name: "← Newer" })).not.toBeVisible();

    await page.getByRole("link", { name: "Older →" }).click();
    await expect(page).toHaveURL(/offset=50/);
    await expect(page.getByText("showing 51")).toBeVisible();
    await expect(page.getByRole("link", { name: "← Newer" })).toBeVisible();

    await page.getByRole("link", { name: "← Newer" }).click();
    await expect(page).toHaveURL(/offset=0/);
    await expect(page.getByText("showing 1")).toBeVisible();
  });
});
