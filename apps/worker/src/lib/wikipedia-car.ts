// Deterministic Wikipedia infobox parser — the "one real, consistent
// place" for a car model/generation's backbone facts (production years,
// platform, engine list, predecessor/successor, assembly plants), used
// instead of re-summarizing a rendered article with an LLM call each
// time. Wikipedia's `{{Infobox automobile}}` template already IS a
// structured key=value record per car/generation article — this just
// reads it directly via MediaWiki's own raw-wikitext API (no
// Cloudflare, no JS rendering, no summarization drift), the same way
// fetch-images.ts already talks to Commons' API directly rather than
// scraping rendered HTML.
//
// This is the backbone source only. Current-year US trim pricing and
// EPA figures still come from a live retail source (Cars.com, Consumer
// Reports) via WebFetch, since Wikipedia rarely has this-model-year
// MSRP — see seed-corolla.ts/seed-civic.ts/etc.'s own source comments
// for that split in practice.

const WIKI_API = "https://en.wikipedia.org/w/api.php";

/** Full-text searches Wikipedia's own search index (the same one the site search box
 * uses) — for research-nameplate.ts's own generation-discovery pass: search for
 * `"{brand} {model}" generation` and try fetching each result's infobox rather than
 * guessing exact "(E53)"-style page titles in advance. */
export async function searchWikipediaTitles(query: string, limit = 10): Promise<string[]> {
  const url = `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Wikipedia search failed (${res.status}) for "${query}"`);
  const json = (await res.json()) as { query?: { search?: { title: string }[] } };
  return (json.query?.search ?? []).map((r) => r.title);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Real gap found live 2026-09-14: research-nameplate.ts fetching a dozen
// candidate pages in a tight sequential loop started drawing real HTTP
// 429s from Wikipedia partway through a run, silently losing every
// remaining candidate's data. One retry after a real backoff delay
// (honoring a `Retry-After` header if Wikipedia sends one) is enough in
// practice at this request volume — this is still a handful of requests
// per nameplate researched, not the kind of sustained load that needs a
// real rate limiter.
async function fetchWikitextImpl(pageTitle: string, fullPage: boolean, attempt = 1): Promise<string> {
  const sectionParam = fullPage ? "" : "&section=0";
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext${sectionParam}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (res.status === 429 && attempt === 1) {
    const retryAfterHeader = Number(res.headers.get("Retry-After"));
    const delayMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : 3000;
    await sleep(delayMs);
    return fetchWikitextImpl(pageTitle, fullPage, 2);
  }
  if (!res.ok) throw new Error(`Wikipedia API fetch failed (${res.status}) for "${pageTitle}"`);
  const json = (await res.json()) as { parse?: { wikitext?: { "*": string } }; error?: { info: string } };
  if (json.error) throw new Error(`Wikipedia API error for "${pageTitle}": ${json.error.info}`);
  const wikitext = json.parse?.wikitext?.["*"];
  if (!wikitext) throw new Error(`No wikitext returned for "${pageTitle}" (page may not exist)`);
  return wikitext;
}

/** Lead section (`section=0`) only — enough for a single {{Infobox automobile}}, and
 * much smaller/faster than the full article. Used by fetchCarInfobox() below. */
export async function fetchWikitext(pageTitle: string): Promise<string> {
  return fetchWikitextImpl(pageTitle, false);
}

/** Full article wikitext, every section — needed by lib/generation-sections.ts to find
 * per-generation "== Nth generation (YYYY–YYYY) ==" headers, which live well past the
 * lead section fetchWikitext() alone would return. */
export async function fetchFullWikitext(pageTitle: string): Promise<string> {
  return fetchWikitextImpl(pageTitle, true);
}

/** Wikipedia uses two infobox templates for cars: {{Infobox automobile}} for
 * conventional models, {{Infobox electric vehicle}} for EVs (found live seeding
 * Tesla Model S — its page has no {{Infobox automobile}} at all). Field names
 * overlap enough (manufacturer, production, class, platform, assembly, image,
 * related, designer, body_style, layout) that the same parser handles both;
 * EV-only fields like motor/battery/electric_range just pass through unused. */
const INFOBOX_TEMPLATE_RE = /\{\{\s*Infobox (?:automobile|electric vehicle)/i;

/** Extracts the first `{{Infobox automobile|electric vehicle ... }}` (brace-depth-aware,
 * since field values routinely contain their own nested templates like {{unbulleted list|...}}). */
function extractInfoboxBlock(wikitext: string): string | null {
  const start = wikitext.search(INFOBOX_TEMPLATE_RE);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < wikitext.length - 1; i++) {
    const two = wikitext.slice(i, i + 2);
    if (two === "{{") {
      depth++;
      i++;
    } else if (two === "}}") {
      depth--;
      i++;
      if (depth === 0) return wikitext.slice(start, i + 1);
    }
  }
  return null;
}

/** Splits `str` on `|` at bracket depth 0 only — a `|` inside `[[a|b]]` or `{{a|b}}`
 * (both common inside `{{unbulleted list|...}}` items) is never treated as a separator. */
function splitTopLevelPipes(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < str.length; i++) {
    const two = str.slice(i, i + 2);
    if (two === "[[" || two === "{{") {
      depth++;
      current += two;
      i++;
    } else if (two === "]]" || two === "}}") {
      depth = Math.max(0, depth - 1);
      current += two;
      i++;
    } else if (str[i] === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += str[i];
    }
  }
  parts.push(current);
  return parts;
}

/** Strips wikilinks/templates/refs/comments down to readable plain text. Not a full
 * wikitext renderer — good enough for infobox field values, which are short and simple. */
export function cleanWikitext(raw: string): string {
  let s = raw;
  s = s.replace(/<!--[\s\S]*?-->/g, ""); // comments
  s = s.replace(/<ref[^>]*\/>/g, ""); // self-closed refs
  s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, ""); // refs with body
  s = s.replace(/\{\{unbulleted list\s*\|([\s\S]*?)\}\}/gi, (_m, inner: string) =>
    splitTopLevelPipes(inner)
      .map((part) => cleanWikitext(part))
      .filter(Boolean)
      .join("; "),
  );
  s = s.replace(/\{\{nowrap\|([^}]*)\}\}/gi, "$1");
  s = s.replace(/\{\{small\|([^}]*)\}\}/gi, "$1");
  s = s.replace(/\{\{[^{}]*\}\}/g, ""); // any other simple (non-nested) template — drop rather than guess
  s = s.replace(/\[\[[^[\]|]*\|([^[\]]*)\]\]/g, "$1"); // [[target|display]] -> display
  s = s.replace(/\[\[([^[\]]*)\]\]/g, "$1"); // [[target]] -> target
  s = s.replace(/'''''|'''|''/g, ""); // bold/italic markup
  s = s.replace(/&nbsp;/g, " ");
  s = s.replace(/<br\s*\/?>/gi, "; ");
  s = s.replace(/[ \t]+/g, " ").trim();
  return s;
}

/** Splits an infobox block into { fieldName: rawWikitextValue } pairs, depth-aware so a
 * field's own nested `{{...}}` content doesn't get mistaken for the next `| field =`. */
export function parseInfoboxFields(infoboxBlock: string): Record<string, string> {
  // Drop the outer "{{Infobox automobile|electric vehicle" ... trailing "}}"
  const inner = infoboxBlock.replace(/^\{\{\s*Infobox (?:automobile|electric vehicle)/i, "").replace(/\}\}$/, "");
  const fields: Record<string, string> = {};
  let depth = 0;
  let currentField: string | null = null;
  let buffer = "";
  const lines = inner.split("\n");
  const flush = () => {
    if (currentField) fields[currentField] = buffer.trim();
    currentField = null;
    buffer = "";
  };
  for (const line of lines) {
    const fieldMatch = depth === 0 ? /^\|\s*([a-zA-Z0-9_]+)\s*=(.*)$/.exec(line) : null;
    if (fieldMatch?.[1] !== undefined && fieldMatch[2] !== undefined) {
      flush();
      currentField = fieldMatch[1];
      buffer = fieldMatch[2];
    } else if (currentField) {
      buffer += "\n" + line;
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth = Math.max(0, depth - 1);
    }
  }
  flush();
  return fields;
}

/** Parses a wikitext `production` field (e.g. "2002–2014", "2015–present", "2011") into
 * a start/end year pair — moved 2026-09-15 from auto-seed-catalog.ts so
 * lib/generation-sections.ts can share it rather than re-deriving the same logic. */
export function parseProductionYears(raw: string | undefined): { startYear: number | null; endYear: number | null } {
  if (!raw) return { startYear: null, endYear: null };
  const years = Array.from(raw.matchAll(/\b(19|20)\d{2}\b/g), (m) => Number(m[0]));
  if (years.length === 0) return { startYear: null, endYear: null };
  const startYear = Math.min(...years);
  const isOngoing = /present/i.test(raw);
  // Real bug found live 2026-09-15 (BMW X3, header "Fourth generation
  // (G45/NA5; 2024/2025)" — two distinct per-market launch years
  // separated by "/", not a production range): treating ANY two years
  // found in the string as start/end wrongly read this as "discontinued
  // 2025" for a nameplate still in production. A real range needs an
  // actual range separator (en/em dash or hyphen) present SOMEWHERE in
  // the string — not necessarily adjacent to the years, since real
  // infobox text like "August 2017 – August 2024" puts a month name
  // between the dash and each year — "2024/2025", "2024, 2025" etc.
  // have no such separator and fall back to leaving endYear unset
  // (safer than a fabricated end date) rather than guessing from raw
  // min/max.
  const hasRangeSeparator = /[–—-]/.test(raw) || /\bto\b/i.test(raw);
  const endYear = isOngoing || !hasRangeSeparator ? null : years.length > 1 ? Math.max(...years) : null;
  return { startYear, endYear };
}

export interface CarInfobox {
  pageTitle: string;
  raw: Record<string, string>;
  /** Same fields as `raw`, with wikitext markup stripped to plain text. */
  clean: Record<string, string>;
}

export async function fetchCarInfobox(pageTitle: string): Promise<CarInfobox> {
  const wikitext = await fetchWikitext(pageTitle);
  const block = extractInfoboxBlock(wikitext);
  if (!block) throw new Error(`No {{Infobox automobile}} found on "${pageTitle}"`);
  const raw = parseInfoboxFields(block);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) clean[k] = cleanWikitext(v);
  return { pageTitle, raw, clean };
}
