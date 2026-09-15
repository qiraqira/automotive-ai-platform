import { fetchFullWikitext, parseInfoboxFields, cleanWikitext, parseProductionYears } from "./wikipedia-car.js";

// Generalizes the pattern found live 2026-09-15 doing Volvo XC90's own
// completeness pass by hand (backfill-xc90-history.ts): many nameplates'
// real Wikipedia article is a SINGLE page with one "== Nth generation
// (YYYY–YYYY) ==" (level-2 only — a level-3 "=== Facelifts ===" etc.
// nested inside must NOT be mistaken for a new generation) section per
// generation, each with its own nested {{Infobox automobile}} giving
// that generation's own platform/production-years/lead-photo — unlike
// the BMW X5/Ford F-150/Mustang/GLE pattern (separate per-generation
// Wikipedia articles, needing research-nameplate.ts's own search-based
// discovery instead). This is the mechanical, reusable half of that
// pattern, so future models don't each need their own hand-written
// backfill-<model>-history.ts the way XC90/GLE/X5/F-150 did — a session
// still reviews the output before writing anything to the database, per
// this project's standing "a person looked at it" rule for photos.

const HEADER_RE = /^==(?!=)(.*?)(?<!=)==\s*$/gm;

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

/** Same brace-depth-aware block extractor as wikipedia-car.ts's own (private) one, but
 * scoped to search from a given offset — needed here since each generation section's
 * infobox must be found within THAT section's own text, not the whole article's first one. */
function extractInfoboxBlockFrom(wikitext: string, searchFrom: number): string | null {
  const rel = wikitext.slice(searchFrom).search(/\{\{\s*Infobox automobile/i);
  if (rel === -1) return null;
  const start = searchFrom + rel;
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

export interface GenerationSection {
  /** Cleaned header text, e.g. "First generation (2002)" */
  headerText: string;
  slug: string;
  name: string;
  startYear: number | null;
  endYear: number | null;
  /** Cleaned infobox fields, or null if this section had no nested {{Infobox automobile}}. */
  infobox: Record<string, string> | null;
}

function slugifyGenerationName(headerText: string): string {
  const withoutYears = headerText.replace(/\(\s*\d{4}[^)]*\)/g, "").trim();
  const slug = withoutYears
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "generation";
}

/** Fetches `pageTitle`'s full wikitext and splits it into one entry per real level-2
 * "generation" section — returns an empty array if the page has 0 or 1 such sections
 * (a single- or zero-generation nameplate isn't this function's problem to solve; the
 * caller decides what a too-short result means). Never writes anything — pure discovery. */
export async function discoverGenerationSections(pageTitle: string): Promise<GenerationSection[]> {
  const wikitext = await fetchFullWikitext(pageTitle);

  // Every level-2 header (generation or not — "Awards and recognition",
  // "Sales", "References" etc. all match HEADER_RE too), kept in full so
  // a "generation" section's body can be scoped up to whichever real
  // header (of any kind) comes next, not just the next generation one.
  const allHeaders: { matchStart: number; matchEnd: number }[] = [];
  for (const m of wikitext.matchAll(HEADER_RE)) {
    allHeaders.push({ matchStart: m.index ?? 0, matchEnd: (m.index ?? 0) + m[0].length });
  }

  const genHeaders: { headerText: string; matchEnd: number }[] = [];
  for (const h of allHeaders) {
    const raw = wikitext.slice(h.matchStart, h.matchEnd);
    const cleaned = stripHtml(raw.replace(/^==+/, "").replace(/==+\s*$/, ""));
    if (!/generation/i.test(cleaned)) continue;
    genHeaders.push({ headerText: cleaned, matchEnd: h.matchEnd });
  }
  if (genHeaders.length < 2) return [];

  const sections: GenerationSection[] = [];
  for (const { headerText, matchEnd } of genHeaders) {
    const nextHeader = allHeaders.find((h) => h.matchStart >= matchEnd);
    const body = wikitext.slice(matchEnd, nextHeader ? nextHeader.matchStart : wikitext.length);

    const block = extractInfoboxBlockFrom(body, 0);
    let infobox: Record<string, string> | null = null;
    if (block) {
      const raw = parseInfoboxFields(block);
      infobox = {};
      for (const [k, v] of Object.entries(raw)) infobox[k] = cleanWikitext(v);
    }

    const headerYears = parseProductionYears(headerText);
    const infoboxYears = parseProductionYears(infobox?.production);
    const startYear = infoboxYears.startYear ?? headerYears.startYear;
    const endYear = infoboxYears.startYear ? infoboxYears.endYear : headerYears.endYear;

    sections.push({
      headerText,
      slug: slugifyGenerationName(headerText),
      name: headerText.replace(/\s*\(\s*\d{4}[^)]*\)\s*$/, "").trim() || headerText,
      startYear,
      endYear,
      infobox,
    });
  }

  // Real gap found live 2026-09-15 (Kia Sorento, Honda Civic): a
  // superseded generation's own infobox/header often gives only a start
  // year with no explicit end (production listed as e.g. just "2002",
  // relying on the next generation's own start date to imply when this
  // one stopped, the way a real reader would). Filling every generation
  // but the last one from its successor's start year (minus one) matches
  // that same real-world reading — only the FINAL section is left
  // open-ended (endYear: null, i.e. "still in production"), which is
  // usually right but can be wrong for a nameplate that was discontinued
  // without a successor; a session reviewing this output should sanity-
  // check the last section specifically before trusting "present".
  for (let i = 0; i < sections.length - 1; i++) {
    const current = sections[i];
    const next = sections[i + 1];
    if (current && next && current.endYear == null && next.startYear != null) {
      current.endYear = next.startYear - 1;
    }
  }

  return sections;
}
