import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@automotive/database";

// Real test-safety fix applied proactively 2026-09-09, same lesson as
// generate-image.test.ts's own comment (found the hard way there, applied
// here before it could bite the same way): ingestSource() now calls
// getEmbedding() (apps/worker/src/embed.ts) once per new item, a real
// `fetch()` to OpenAI. This file's own mockRobotsAllowedThenFeeds() below
// only queues exactly 2 `mockResolvedValueOnce` responses per feed (robots
// check + feed fetch) — any further fetch call falls through to the REAL
// global.fetch, and the real environment these tests run in (the VPS
// worker container) has a real OPENAI_API_KEY configured. Mocking the
// whole module (not fetch) makes every existing test below behave exactly
// as it did before this function existed — getEmbedding() returning null
// is real, legitimate behavior (the same thing it returns when
// OPENAI_API_KEY is simply unset), so this changes nothing about what's
// being tested, only guarantees zero real network calls regardless of
// what real environment variables happen to be set wherever this runs.
// Real, live-caught mistake while first writing this mock: initially
// stubbed `cosineSimilarity` too (as an always-0 function), which broke
// the embedding-fallback test below in a subtle way — it silently never
// matched anything, since the pure-math similarity check ingest.ts
// actually runs always saw 0 regardless of the mocked embeddings, no
// matter how similar. Caught by that test actually failing
// (`storiesCreated` was 1, not 0 — the real bug-detection this test
// exists for). Only `getEmbedding` (the real network call) needs
// mocking; `cosineSimilarity` is pure math with no network/DB dependency
// and is kept real via `importActual` so the fallback logic is genuinely
// exercised, not stubbed into never working.
vi.mock("../embed.js", async () => {
  const actual = await vi.importActual<typeof import("../embed.js")>("../embed.js");
  return { ...actual, getEmbedding: vi.fn().mockResolvedValue(null) };
});

const { ingestSource } = await import("../ingest.js");

// Real integration test against the actual local Postgres (same convention
// as apps/api's __tests__/api.test.ts) — only `fetch` is mocked, since
// hitting a real feed's live content on every test run isn't reproducible.
// Uses deliberately unique "Zzqxfixture" titles (same reason apps/api's
// search test moved off "Tesla": a shared, accumulating real DB could
// otherwise coincidentally pg_trgm-match a real ingested story).

// ingestSource() now checks robots.txt before every feed fetch (real gap
// fixed 2026-09-07 — see ingest.ts's own comment). This mocks that first
// call as a 404 (robots.txt not found → "allowed", the real robots.txt
// convention) before each real feed-fetch mock, so existing/new tests
// don't need to reason about robots.txt at all unless that's the actual
// point of the test.
function mockRobotsAllowedThenFeeds(...feedXmls: string[]) {
  const spy = vi.spyOn(global, "fetch");
  for (const xml of feedXmls) {
    spy.mockResolvedValueOnce(new Response("", { status: 404 }));
    spy.mockResolvedValueOnce(new Response(xml, { status: 200 }));
  }
  return spy;
}

function rssFeed(items: { title: string; link: string; author?: string }[]): string {
  const itemsXml = items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link><pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>${
          i.author ? `<dc:creator><![CDATA[${i.author}]]></dc:creator>` : ""
        }</item>`,
    )
    .join("");
  return `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Fixture Feed</title>${itemsXml}</channel></rss>`;
}

describe("ingestSource", () => {
  let sourceId: string;
  const createdStoryIds = new Set<string>();

  beforeEach(async () => {
    const source = await prisma.source.create({
      data: {
        name: "Zzqxfixture Test Source",
        url: "https://test.invalid/zzqxfixture",
        feedUrl: "https://test.invalid/zzqxfixture/feed.xml",
        country: "US",
        language: "en",
        type: "NEWS_MEDIA",
        tier: "SPECIALIST",
        trustScore: 50,
      },
    });
    sourceId = source.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const storyId of createdStoryIds) {
      await prisma.storyEvent.deleteMany({ where: { storyId } });
      await prisma.storySource.deleteMany({ where: { storyId } });
      await prisma.sourceArticle.deleteMany({ where: { storyId } });
      await prisma.story.deleteMany({ where: { id: storyId } });
    }
    createdStoryIds.clear();
    // SourceAuthor.sourceId is a loose reference (no @relation/FK, see
    // ingest.ts's resolveSourceAuthor() comment) — deleting the fixture
    // Source below won't cascade to it, so it needs its own cleanup.
    await prisma.sourceAuthor.deleteMany({ where: { sourceId } });
    await prisma.source.delete({ where: { id: sourceId } });
  });

  it("creates a Story + a 'discovered' StoryEvent for a genuinely new item", async () => {
    mockRobotsAllowedThenFeeds(
      rssFeed([{ title: "Zzqxfixture Motors Unveils The Zzqxfixture Concept Car", link: "https://test.invalid/a1" }]),
    );

    const result = await ingestSource(sourceId);
    expect(result.storiesCreated).toBe(1);
    expect(result.articlesCreated).toBe(1);

    const article = await prisma.sourceArticle.findFirst({ where: { url: "https://test.invalid/a1" } });
    expect(article?.storyId).toBeTruthy();
    createdStoryIds.add(article!.storyId!);

    const events = await prisma.storyEvent.findMany({ where: { storyId: article!.storyId! } });
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("discovered");
    expect(events[0].description).toContain("Zzqxfixture Test Source");

    // Real gap fixed 2026-09-07: importanceScore used to sit at this
    // schema default forever for every real Story — this locks in that a
    // brand-new single-source story is unaffected (no regression), while
    // the dedicated multi-source test below locks in the real boost.
    const story = await prisma.story.findUniqueOrThrow({ where: { id: article!.storyId! } });
    expect(story.importanceScore).toBe(30);
  });

  it("creates a 'new coverage' StoryEvent when a second item clusters into the same Story", async () => {
    mockRobotsAllowedThenFeeds(
      rssFeed([{ title: "Zzqxfixture Motors Recalls The Zzqxfixture Sedan Over Battery Risk", link: "https://test.invalid/b1" }]),
      rssFeed([{ title: "Zzqxfixture Motors Recalls The Zzqxfixture Sedan Over Battery Risk Again", link: "https://test.invalid/b2" }]),
    );

    const first = await ingestSource(sourceId);
    expect(first.storiesCreated).toBe(1);
    const articleB1 = await prisma.sourceArticle.findFirst({ where: { url: "https://test.invalid/b1" } });
    const storyId = articleB1!.storyId!;
    createdStoryIds.add(storyId);

    const second = await ingestSource(sourceId);
    expect(second.storiesUpdated).toBe(1);
    expect(second.storiesCreated).toBe(0);

    const articleB2 = await prisma.sourceArticle.findFirst({ where: { url: "https://test.invalid/b2" } });
    expect(articleB2?.storyId).toBe(storyId);

    const events = await prisma.storyEvent.findMany({ where: { storyId }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.label)).toEqual(["discovered", "new coverage"]);
    expect(events[1].description).toContain("similarity");

    // The SAME source publishing a second, later item about the same
    // Story is still only ONE distinct source — importanceScore's real
    // signal (see importance.ts) must not confuse "this outlet posted an
    // update" with "a second outlet independently chose to cover this."
    const story = await prisma.story.findUniqueOrThrow({ where: { id: storyId } });
    expect(story.importanceScore).toBe(30);
  });

  it("clusters two genuinely differently-worded titles into the same Story via the embedding fallback — real fix for the exact live-caught gap in ingest.ts's own TITLE_SIMILARITY_THRESHOLD comment (two outlets covering the same event in different words)", async () => {
    const { getEmbedding } = await import("../embed.js");
    // Real, low pg_trgm similarity by design — these two titles share
    // only the word "Zzqxfixture", the same shape as the real InsideEVs/
    // Electrek Polestar headlines this feature was built for (0.28 real
    // trigram similarity, see embed.ts's own comment). Mocked embeddings
    // stand in for the real 0.78 cosine similarity confirmed live for
    // that real pair.
    vi.mocked(getEmbedding).mockResolvedValueOnce([0.8, 0.6, 0, 0]).mockResolvedValueOnce([0.6, 0.8, 0, 0]);

    mockRobotsAllowedThenFeeds(
      rssFeed([{ title: "Zzqxfixture Teases Next Concept In Cryptic New Video", link: "https://test.invalid/e1" }]),
      rssFeed([{ title: "Sources Confirm The Zzqxfixture Reveal Everyone Expected", link: "https://test.invalid/e2" }]),
    );

    const first = await ingestSource(sourceId);
    expect(first.storiesCreated).toBe(1);
    const articleE1 = await prisma.sourceArticle.findFirst({ where: { url: "https://test.invalid/e1" } });
    const storyId = articleE1!.storyId!;
    createdStoryIds.add(storyId);

    const second = await ingestSource(sourceId);
    expect(second.storiesCreated).toBe(0);
    expect(second.storiesUpdated).toBe(1);

    const articleE2 = await prisma.sourceArticle.findFirst({ where: { url: "https://test.invalid/e2" } });
    expect(articleE2?.storyId).toBe(storyId);

    const events = await prisma.storyEvent.findMany({ where: { storyId }, orderBy: { createdAt: "asc" } });
    expect(events[1]!.description).toContain("semantic match");
  });

  it("boosts importanceScore when a genuinely different source's coverage clusters into an existing Story — the real fix for a gap where this, the most heavily-weighted input to the homepage's real ranking algorithm, sat at its schema default forever", async () => {
    const secondSource = await prisma.source.create({
      data: {
        name: "Zzqxfixture Second Test Source",
        url: "https://test.invalid/zzqxfixture-second",
        feedUrl: "https://test.invalid/zzqxfixture-second/feed.xml",
        type: "NEWS_MEDIA",
        tier: "SPECIALIST",
        trustScore: 50,
      },
    });

    try {
      mockRobotsAllowedThenFeeds(
        rssFeed([{ title: "Zzqxfixture Recalls The Zzqxfixture Hatchback Over Brake Failure", link: "https://test.invalid/f1" }]),
        rssFeed([{ title: "Zzqxfixture Recalls The Zzqxfixture Hatchback Over Brake Failure Too", link: "https://test.invalid/f2" }]),
      );

      const first = await ingestSource(sourceId);
      expect(first.storiesCreated).toBe(1);
      const articleF1 = await prisma.sourceArticle.findFirst({ where: { url: "https://test.invalid/f1" } });
      const storyId = articleF1!.storyId!;
      createdStoryIds.add(storyId);

      const storyAfterFirst = await prisma.story.findUniqueOrThrow({ where: { id: storyId } });
      expect(storyAfterFirst.importanceScore).toBe(30);

      const second = await ingestSource(secondSource.id);
      expect(second.storiesUpdated).toBe(1);

      const storyAfterSecond = await prisma.story.findUniqueOrThrow({ where: { id: storyId } });
      expect(storyAfterSecond.importanceScore).toBe(55);

      const sourceCount = await prisma.storySource.count({ where: { storyId } });
      expect(sourceCount).toBe(2);
    } finally {
      // SourceArticle.sourceId has a real (non-cascading) FK, unlike
      // StorySource's — its own row (the "f2" article) must go first.
      await prisma.sourceArticle.deleteMany({ where: { sourceId: secondSource.id } });
      await prisma.source.delete({ where: { id: secondSource.id } });
    }
  });

  it("creates a real EntityRelation to the real seeded BMW 3 Series when a title precisely mentions a real trim", async () => {
    const series3 = await prisma.carModel.findFirst({ where: { slug: "3-series", brand: { slug: "bmw" } } });
    expect(series3).toBeTruthy(); // assumes `npm run db:seed` has been run, same assumption every apps/api test makes

    mockRobotsAllowedThenFeeds(
      rssFeed([{ title: "Zzqxfixture Review: The 2027 BMW 330i Is Sharper Than Ever", link: "https://test.invalid/c1" }]),
    );

    const result = await ingestSource(sourceId);
    expect(result.storiesCreated).toBe(1);
    const article = await prisma.sourceArticle.findFirst({ where: { url: "https://test.invalid/c1" } });
    createdStoryIds.add(article!.storyId!);

    const relation = await prisma.entityRelation.findFirst({
      where: { fromType: "story", fromId: article!.storyId!, toType: "car_model", toId: series3!.id },
    });
    expect(relation).toMatchObject({ relation: "mentions" });
    await prisma.entityRelation.deleteMany({ where: { fromType: "story", fromId: article!.storyId! } });
  });

  it("does NOT create an EntityRelation for a title that only mentions the brand, not a precise model/trim", async () => {
    mockRobotsAllowedThenFeeds(
      rssFeed([{ title: "Zzqxfixture: BMW Announces Record Global Sales For The Quarter", link: "https://test.invalid/c2" }]),
    );

    const result = await ingestSource(sourceId);
    expect(result.storiesCreated).toBe(1);
    const article = await prisma.sourceArticle.findFirst({ where: { url: "https://test.invalid/c2" } });
    createdStoryIds.add(article!.storyId!);

    const relations = await prisma.entityRelation.findMany({ where: { fromType: "story", fromId: article!.storyId! } });
    expect(relations).toHaveLength(0);
  });

  it("resolves a real dc:creator byline into a SourceAuthor and links it, scoped to this Source — the real fix for a gap where SourceAuthor sat entirely unused since the schema scaffold", async () => {
    mockRobotsAllowedThenFeeds(
      rssFeed([
        {
          title: "Zzqxfixture Automaker Unveils The Zzqxfixture Roadster",
          link: "https://test.invalid/d1",
          author: "Zzqxfixture Author",
        },
      ]),
    );

    const result = await ingestSource(sourceId);
    expect(result.storiesCreated).toBe(1);

    const article = await prisma.sourceArticle.findFirst({
      where: { url: "https://test.invalid/d1" },
      include: { author: true },
    });
    createdStoryIds.add(article!.storyId!);

    expect(article!.author).toMatchObject({ name: "Zzqxfixture Author", sourceId });
  });

  it("reuses the same SourceAuthor row for a second item from the same author, rather than creating a duplicate", async () => {
    mockRobotsAllowedThenFeeds(
      rssFeed([
        { title: "Zzqxfixture Author Writes About The Zzqxfixture Coupe", link: "https://test.invalid/e1", author: "Zzqxfixture Repeat Author" },
      ]),
      rssFeed([
        { title: "Zzqxfixture Author Writes About The Zzqxfixture Wagon Too", link: "https://test.invalid/e2", author: "Zzqxfixture Repeat Author" },
      ]),
    );

    const first = await ingestSource(sourceId);
    expect(first.storiesCreated).toBe(1);
    const articleE1 = await prisma.sourceArticle.findFirst({ where: { url: "https://test.invalid/e1" } });
    createdStoryIds.add(articleE1!.storyId!);

    const second = await ingestSource(sourceId);
    // Not asserting storiesCreated here: these two deliberately similar
    // titles (same author, same real point being tested) may cluster
    // into the same Story via pg_trgm similarity — irrelevant to this
    // test's actual point, which is authorId reuse, not clustering.
    expect(second.articlesCreated).toBe(1);
    const articleE2 = await prisma.sourceArticle.findFirst({ where: { url: "https://test.invalid/e2" } });
    createdStoryIds.add(articleE2!.storyId!);

    expect(articleE2!.authorId).toBe(articleE1!.authorId);
    const authorCount = await prisma.sourceAuthor.count({ where: { sourceId, name: "Zzqxfixture Repeat Author" } });
    expect(authorCount).toBe(1);
  });

  it("skips a deactivated source without attempting a fetch", async () => {
    await prisma.source.update({ where: { id: sourceId }, data: { active: false } });
    const fetchSpy = vi.spyOn(global, "fetch");

    const result = await ingestSource(sourceId);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.itemsSeen).toBe(0);
    expect(result.errors).toEqual(["Source is inactive — skipped, no fetch attempted"]);
  });

  it("passes a real AbortSignal on the feed fetch, so a hanging source server can actually be aborted — the real fix for a gap where this fetch had no timeout at all", async () => {
    const spy = mockRobotsAllowedThenFeeds(rssFeed([]));

    await ingestSource(sourceId);

    // Second call is the real feed fetch (first is the robots.txt check).
    expect(spy.mock.calls[1]![1]).toMatchObject({ signal: expect.any(AbortSignal) });
  });

  it("skips the feed fetch entirely and records a real SystemAlert when robots.txt disallows it — the real fix for a gap where Source.robotsStatus sat unused since the schema scaffold", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("User-agent: *\nDisallow: /\n", { status: 200 }),
    );

    const result = await ingestSource(sourceId);

    expect(result.itemsSeen).toBe(0);
    expect(result.errors).toEqual(["robots.txt disallows this feed path — skipped, no fetch attempted"]);

    const source = await prisma.source.findUniqueOrThrow({ where: { id: sourceId } });
    expect(source.robotsStatus).toBe("disallowed");

    const alert = await prisma.systemAlert.findFirst({
      where: { source: "crawler", message: { contains: "robots.txt now disallows" } },
      orderBy: { createdAt: "desc" },
    });
    expect(alert).toMatchObject({ severity: "WARNING" });
    await prisma.systemAlert.deleteMany({ where: { id: alert!.id } });
  });

  // Real test-coverage gap found and fixed 2026-09-08: this is the
  // PRIMARY crawler-failure path (a source's own server returning a
  // real error, or a genuine network failure) — a more common real-world
  // scenario than the robots.txt-disallow path above, which already had
  // both a create-alert and a don't-re-alert test. This one had NEITHER:
  // nothing ever exercised the actual `catch` block in `ingestSource()`
  // that creates a WARNING SystemAlert with the real fetch failure
  // message, or its own "only alert on a NEW failure" dedup logic
  // (`source.lastError !== message`) — a real, non-trivial piece of
  // business logic (preventing alert-spam from a source stuck failing
  // every crawl cycle) that had never been verified to actually work.
  it("records a real WARNING SystemAlert with the real error message when the feed fetch itself fails, and updates Source.lastError/lastErrorAt", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 404 })) // robots.txt: allowed
      .mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 })); // feed fetch itself fails

    const result = await ingestSource(sourceId);

    expect(result.itemsSeen).toBe(0);
    expect(result.errors).toEqual(["HTTP 500"]);

    const source = await prisma.source.findUniqueOrThrow({ where: { id: sourceId } });
    expect(source.lastError).toBe("HTTP 500");
    expect(source.lastErrorAt).not.toBeNull();

    const alert = await prisma.systemAlert.findFirst({
      where: { source: "crawler", message: { contains: "failed to fetch" } },
      orderBy: { createdAt: "desc" },
    });
    expect(alert).toMatchObject({ severity: "WARNING", message: expect.stringContaining("HTTP 500") });
    await prisma.systemAlert.deleteMany({ where: { id: alert!.id } });
  });

  it("does not re-alert when the exact same feed-fetch failure repeats on the next cycle, but DOES alert again if the error message changes", async () => {
    await prisma.source.update({ where: { id: sourceId }, data: { lastError: "HTTP 500" } });
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 404 })) // robots.txt: allowed
      .mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 })); // same failure as before

    const alertCountBefore = await prisma.systemAlert.count({ where: { source: "crawler" } });
    await ingestSource(sourceId);
    const alertCountAfterSameError = await prisma.systemAlert.count({ where: { source: "crawler" } });
    expect(alertCountAfterSameError).toBe(alertCountBefore);

    // Now the error genuinely changes (a different real failure mode) —
    // this SHOULD alert again, proving the dedup is "same message as
    // last time", not "never alert twice for this source, ever".
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 404 })) // robots.txt: allowed
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 })); // a different real failure

    await ingestSource(sourceId);
    const alertCountAfterDifferentError = await prisma.systemAlert.count({ where: { source: "crawler" } });
    expect(alertCountAfterDifferentError).toBe(alertCountBefore + 1);

    await prisma.systemAlert.deleteMany({
      where: { source: "crawler", message: { contains: "failed to fetch" } },
    });
  });

  it("does not re-alert on every cycle once a source is already known to be disallowed", async () => {
    await prisma.source.update({ where: { id: sourceId }, data: { robotsStatus: "disallowed" } });
    vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("User-agent: *\nDisallow: /\n", { status: 200 }));

    const alertCountBefore = await prisma.systemAlert.count({ where: { source: "crawler" } });
    await ingestSource(sourceId);
    const alertCountAfter = await prisma.systemAlert.count({ where: { source: "crawler" } });

    expect(alertCountAfter).toBe(alertCountBefore);
  });
});
