import { describe, expect, it } from "vitest";
import { parseFeed } from "../rss.js";

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example Automotive News</title>
    <item>
      <title>BMW reveals new 3 Series</title>
      <link>https://example.com/bmw-reveals-new-3-series</link>
      <pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate>
      <description>BMW today announced &lt;b&gt;the new G21&lt;/b&gt; generation.</description>
      <guid>https://example.com/bmw-reveals-new-3-series</guid>
      <dc:creator><![CDATA[Jo Borrás]]></dc:creator>
    </item>
    <item>
      <title>Item with no link</title>
      <description>Should be filtered out.</description>
    </item>
    <item>
      <title>Item with a plain author tag, no dc:creator</title>
      <link>https://example.com/plain-author-item</link>
      <author>jane@example.com (Jane Doe)</author>
    </item>
    <item>
      <title>Item with neither dc:creator nor author</title>
      <link>https://example.com/no-author-item</link>
    </item>
    <item>
      <title>BYD&#8217;s new Defender-like SUV breaks cover for the first time</title>
      <link>https://example.com/byd-defender-like-suv</link>
      <description>The new SUV has a &#8216;boxy&#8217; look &amp; real off-road hardware.</description>
    </item>
    <item>
      <title>Item with a malformed pubDate</title>
      <link>https://example.com/malformed-date-item</link>
      <pubDate>not a real date at all</pubDate>
    </item>
    <item>
      <title>Item with no pubDate at all</title>
      <link>https://example.com/no-date-item</link>
    </item>
  </channel>
</rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom Feed</title>
  <entry>
    <title>Tesla updates Model Y range</title>
    <link rel="alternate" href="https://example.com/tesla-model-y-range" />
    <link rel="self" href="https://example.com/feed/tesla-model-y-range" />
    <updated>2026-09-01T10:00:00Z</updated>
    <summary>Tesla increased the EPA-rated range.</summary>
    <id>urn:uuid:abc-123</id>
    <author><name>Alex Rivera</name></author>
  </entry>
</feed>`;

describe("parseFeed — RSS 2.0", () => {
  it("extracts title/link/date/excerpt from a real-shaped RSS item", () => {
    const items = parseFeed(RSS_SAMPLE);
    const bmwItem = items.find((i) => i.title === "BMW reveals new 3 Series");
    expect(bmwItem).toMatchObject({
      title: "BMW reveals new 3 Series",
      link: "https://example.com/bmw-reveals-new-3-series",
      guid: "https://example.com/bmw-reveals-new-3-series",
    });
    expect(bmwItem!.publishedAt).toBeInstanceOf(Date);
    expect(bmwItem!.excerpt).toContain("the new G21");
  });

  it("filters out items with no link (title-only garbage some feeds emit)", () => {
    const items = parseFeed(RSS_SAMPLE);
    expect(items.some((i) => i.title === "Item with no link")).toBe(false);
  });

  // Real, live-confirmed bug found 2026-09-09 (spotted on the real
  // homepage — a real Electrek title rendered as literal
  // "BYD&#8217;s new Defender-like SUV..." instead of "BYD's..."). Root
  // cause verified against electrek.co's own real live feed bytes: the
  // real XML genuinely contains this exact numeric character reference,
  // not double-encoded — a compliant parser is expected to decode it.
  // fast-xml-parser's own defaults do NOT decode numeric entities
  // without `htmlEntities: true` (verified live against the installed
  // version before adding that option to rss.ts's own parser config).
  it("decodes real numeric HTML entities in titles/excerpts instead of leaving them literal", () => {
    const items = parseFeed(RSS_SAMPLE);
    const item = items.find((i) => i.link === "https://example.com/byd-defender-like-suv");
    expect(item!.title).toBe("BYD’s new Defender-like SUV breaks cover for the first time");
    expect(item!.excerpt).toBe("The new SUV has a ‘boxy’ look & real off-road hardware.");
  });

  // Real gap found and fixed 2026-09-07: `SourceAuthor` sat entirely
  // unused since the initial schema scaffold. `<dc:creator>` is verified
  // live against electrek.co's real feed (a WordPress site) — the exact
  // shape reproduced here, CDATA included.
  it("extracts the author from a real dc:creator element", () => {
    const items = parseFeed(RSS_SAMPLE);
    const bmwItem = items.find((i) => i.title === "BMW reveals new 3 Series");
    expect(bmwItem!.author).toBe("Jo Borrás");
  });

  it("falls back to the plain <author> element, extracting just the name in parens (RSS 2.0's own 'email (Name)' convention) when dc:creator is absent", () => {
    const items = parseFeed(RSS_SAMPLE);
    const plainAuthorItem = items.find((i) => i.title === "Item with a plain author tag, no dc:creator");
    expect(plainAuthorItem!.author).toBe("Jane Doe");
  });

  it("returns null (not a fabricated fallback) when a feed provides no author at all — a real, honest per-source gap: insideevs.com and motor1.com's real feeds carry no author field", () => {
    const items = parseFeed(RSS_SAMPLE);
    const noAuthorItem = items.find((i) => i.title === "Item with neither dc:creator nor author");
    expect(noAuthorItem!.author).toBeNull();
  });

  // Real test-coverage gap found and fixed 2026-09-08: parseDate() (this
  // file's own internal helper) already guards against a malformed date
  // string with a real `Number.isNaN(d.getTime())` check — real,
  // external, untrusted feed data (exactly the kind of input the rest of
  // this file's author-extraction fixes above were built around) — but
  // nothing had ever exercised that guard; every existing test only used
  // a real, well-formed pubDate. `new Date("not a real date at all")`
  // doesn't throw, it silently produces an "Invalid Date" object whose
  // `.getTime()` is NaN — if this guard were ever accidentally removed or
  // weakened, nothing would have caught it.
  it("returns null publishedAt (not an Invalid Date) for a real malformed pubDate, without throwing", () => {
    const items = parseFeed(RSS_SAMPLE);
    const malformedDateItem = items.find((i) => i.title === "Item with a malformed pubDate");
    expect(malformedDateItem!.publishedAt).toBeNull();
  });

  it("returns null publishedAt when a feed item has no pubDate at all", () => {
    const items = parseFeed(RSS_SAMPLE);
    const noDateItem = items.find((i) => i.title === "Item with no pubDate at all");
    expect(noDateItem!.publishedAt).toBeNull();
  });
});

describe("parseFeed — Atom", () => {
  it("picks the alternate (HTML) link, not the self/feed link", () => {
    const items = parseFeed(ATOM_SAMPLE);
    expect(items).toHaveLength(1);
    expect(items[0]!.link).toBe("https://example.com/tesla-model-y-range");
  });

  it("parses the updated date and summary", () => {
    const items = parseFeed(ATOM_SAMPLE);
    expect(items[0]!.publishedAt?.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(items[0]!.excerpt).toContain("EPA-rated range");
  });

  it("extracts the author from Atom's <author><name> element", () => {
    const items = parseFeed(ATOM_SAMPLE);
    expect(items[0]!.author).toBe("Alex Rivera");
  });
});

describe("parseFeed — unrecognized format", () => {
  it("returns an empty array instead of throwing", () => {
    expect(parseFeed("<not-a-feed><x/></not-a-feed>")).toEqual([]);
  });
});
