import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  title: string;
  link: string;
  publishedAt: Date | null;
  excerpt: string | null;
  guid: string | null;
  author: string | null;
}

// Real, live-confirmed data-quality bug found 2026-09-09 (spotted on the
// real homepage — a real Electrek title rendered as literal
// "BYD&#8217;s new Defender-like SUV..." instead of "BYD's..."). Root
// cause verified against the real live feed's own raw bytes (not
// assumed): electrek.co's actual RSS XML genuinely contains the single,
// standard numeric character reference `&#8217;` in `<title>` text — not
// double-encoded by the source, just a normal (if old-fashioned)
// numeric entity a fully-compliant XML/HTML-aware parser is expected to
// decode. fast-xml-parser's own defaults do NOT decode numeric character
// references without `htmlEntities: true` — verified live with the
// installed version before adding this: identical input decodes
// correctly to "BYD’s new SUV" only with this flag set, and stays
// literal "&#8217;" without it.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  htmlEntities: true,
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)["#text"] ?? "");
  }
  return value == null ? "" : String(value);
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(textOf(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

// Real gap found and fixed 2026-09-07: `SourceAuthor` has sat entirely
// unused since the initial schema scaffold — every real byline this
// crawler has ever seen was silently discarded. Confirmed live against
// all 3 real seeded feeds before writing this: electrek.co's feed (a
// WordPress site) carries a real `<dc:creator>` per item; insideevs.com
// and motor1.com (both Laminas_Feed_Writer output) carry no author field
// at all — an honest per-source gap, not something to paper over with a
// fake fallback. RSS 2.0's own plain `<author>` element (when present) is
// conventionally "email@example.com (Real Name)" — extracts just the
// name in parens when that shape matches, else uses the raw text.
function extractRssAuthor(item: Record<string, unknown>): string | null {
  const creator = item["dc:creator"];
  if (creator) return textOf(creator).trim() || null;

  const author = item.author;
  if (!author) return null;
  const raw = textOf(author).trim();
  const nameInParens = /\(([^)]+)\)/.exec(raw);
  return (nameInParens?.[1] ?? raw).trim() || null;
}

/** Supports RSS 2.0 (<rss><channel><item>) and Atom (<feed><entry>) — the
 * two formats spec §11 lists first. Anything else (official JSON APIs,
 * etc.) gets its own parser later rather than forcing it through this one. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);

  if (doc.rss?.channel) {
    const items = toArray(doc.rss.channel.item);
    return items
      .map((item: any): FeedItem => ({
        title: textOf(item.title).trim(),
        link: textOf(item.link).trim(),
        publishedAt: parseDate(item.pubDate),
        excerpt: item.description ? textOf(item.description).trim().slice(0, 500) : null,
        guid: item.guid ? textOf(item.guid).trim() : null,
        author: extractRssAuthor(item),
      }))
      .filter((item) => item.title && item.link);
  }

  if (doc.feed?.entry) {
    const entries = toArray(doc.feed.entry);
    return entries
      .map((entry: any): FeedItem => {
        const links = toArray(entry.link);
        const htmlLink = links.find((l: any) => l?.["@_rel"] === "alternate") ?? links[0];
        return {
          title: textOf(entry.title).trim(),
          link: textOf(htmlLink?.["@_href"] ?? htmlLink).trim(),
          publishedAt: parseDate(entry.updated ?? entry.published),
          excerpt: entry.summary ? textOf(entry.summary).trim().slice(0, 500) : null,
          guid: entry.id ? textOf(entry.id).trim() : null,
          author: entry.author?.name ? textOf(entry.author.name).trim() || null : null,
        };
      })
      .filter((item) => item.title && item.link);
  }

  return [];
}
