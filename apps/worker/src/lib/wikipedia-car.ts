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

export async function fetchWikitext(pageTitle: string): Promise<string> {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&section=0&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Wikipedia API fetch failed (${res.status}) for "${pageTitle}"`);
  const json = (await res.json()) as { parse?: { wikitext?: { "*": string } }; error?: { info: string } };
  if (json.error) throw new Error(`Wikipedia API error for "${pageTitle}": ${json.error.info}`);
  const wikitext = json.parse?.wikitext?.["*"];
  if (!wikitext) throw new Error(`No wikitext returned for "${pageTitle}" (page may not exist)`);
  return wikitext;
}

/** Extracts the first `{{Infobox automobile ... }}` (brace-depth-aware, since field
 * values routinely contain their own nested templates like {{unbulleted list|...}}). */
function extractInfoboxBlock(wikitext: string): string | null {
  const start = wikitext.search(/\{\{\s*Infobox automobile/i);
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
  // Drop the outer "{{Infobox automobile" ... trailing "}}"
  const inner = infoboxBlock.replace(/^\{\{\s*Infobox automobile/i, "").replace(/\}\}$/, "");
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
