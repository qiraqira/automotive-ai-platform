// Deterministic IIHS ratings parser — no LLM call, no WebFetch-style
// summarization. IIHS's vehicle rating pages are plain server-rendered
// HTML (Vue with v-scrollspy, not a client-side SPA) and block a bare
// `fetch()` with no User-Agent, but a normal browser UA gets a real 200
// with no Cloudflare challenge — verified live 2026-09-13 against real
// Corolla/CR-V/Model Y pages.
//
// Built after several manual WebFetch (LLM-summarized) lookups this
// session got a rating page's own model-year-specific data right, but at
// real per-lookup token/time cost and with real risk of misreading which
// exact model year's badge a summary was describing (see the Tesla
// Model Y case this file's own author hit live: the "/2026" URL and the
// "/2025" URL for the same nameplate can carry two different Top Safety
// Pick outcomes, and only reading the page's own explicit tested-year
// markers gets that right every time). This parser reads the same
// explicit markers a human would, mechanically, instead of asking an LLM
// to summarize prose about them.
//
// Usage: fetchIihsRating("https://www.iihs.org/ratings/vehicle/<make>/<model-slug>/<year>")

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type TopSafetyPickTier = "none" | "pick" | "pick_plus";

export interface IihsRating {
  sourceUrl: string;
  pageTitle: string | null;
  topSafetyPick: TopSafetyPickTier;
  /** e.g. { "Small overlap front": "Good", "Moderate overlap front: updated test": "Marginal", ... } */
  categories: Record<string, string>;
  /** Every distinct "Tested vehicle: <kbd>YYYY ...</kbd>" year mentioned on the page, ascending. */
  testedYears: number[];
}

export async function fetchIihsRating(url: string): Promise<IihsRating> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`IIHS fetch failed (${res.status}) for ${url}`);
  const html = await res.text();
  return parseIihsHtml(html, url);
}

export function parseIihsHtml(html: string, sourceUrl: string): IihsRating {
  let topSafetyPick: TopSafetyPickTier = "none";
  const tspMatch = /class="TSP-viewer">.*?<span class="tsp\s*"[^>]*>([^<]+)</s.exec(html);
  if (tspMatch?.[1]) {
    const label = tspMatch[1].trim();
    topSafetyPick = label.includes("+") || /plus/i.test(label) ? "pick_plus" : "pick";
  }

  // Every "<a href="#anchor">Category label</a></th>" is followed, within
  // a bounded window (handles 1-2 levels of wrapper <div>s IIHS's markup
  // uses inconsistently across sections), by the rating letter's own
  // accessible label: <abbr aria-label="Good|Acceptable|Marginal|Poor" ...>.
  const categories: Record<string, string> = {};
  const rowPattern = /<a href="#[^"]+">([^<]+)<\/a><\/th>[\s\S]{0,300}?<abbr aria-label="([^"]+)"/g;
  for (const m of html.matchAll(rowPattern)) {
    if (m[1] && m[2]) categories[m[1].trim()] = m[2].trim();
  }

  const testedYears = Array.from(new Set(Array.from(html.matchAll(/Tested vehicle:\s*<kbd>\s*(\d{4})/g), (m) => Number(m[1])))).sort(
    (a, b) => a - b,
  );

  const titleMatch = /<title>\s*([^<]+?)\s*<\/title>/.exec(html);

  return { sourceUrl, pageTitle: titleMatch?.[1] ? titleMatch[1].trim() : null, topSafetyPick, categories, testedYears };
}
