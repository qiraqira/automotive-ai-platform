import { fetchNameplateHistory } from "./lib/epa-fuel-economy.js";
import { fetchCarInfobox, searchWikipediaTitles } from "./lib/wikipedia-car.js";
import { searchCommonsCandidates } from "./lib/commons-search.js";

// CLI wrapper (`npm run research:nameplate --workspace @automotive/worker
// -- "<Brand>" "<Model>" <epaStartYear> <epaEndYear>`). User's explicit
// ask (2026-09-14): one parser that gathers everything for a nameplate
// — pulls the real EPA year-by-year trim history, discovers the real
// Wikipedia generation articles instead of requiring them to be guessed
// in advance, and finds real Commons photo candidates per generation —
// so a session reviews one consolidated report instead of chaining 8-10
// separate manual lookups per model the way earlier passes this session
// did by hand.
//
// Deliberately stops short of writing anything to the database or
// picking a final photo on its own: every photo candidate here is
// listed, not downloaded or self-hosted, and every generation found is
// reported, not auto-accepted — this project's own "a person actually
// looked at it" rule for photos, and "don't invent a generation
// boundary Wikipedia doesn't actually document" rule for history, both
// still apply. This script does the mechanical gathering; a session
// still does the judgment.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface GenerationResearch {
  wikipediaTitle: string;
  /** A HINT, not a filter — real gap found live researching the Ford F-150 (its real
   * Wikipedia generation articles are titled "Ford F-Series (Nth generation)", so a
   * strict brand+model substring check rejected every one of them and would have
   * silently thrown away their already-fetched infobox data). Every candidate with a
   * real infobox is always reported; this just flags the likely-relevant ones so a
   * session can scan a long report quickly without anything being hidden outright. */
  looksRelevant: boolean;
  infobox: Record<string, string> | null;
  /** A short, mechanically-assembled (not written/invented) one-line summary from the
   * infobox's own fields, purely so a report reader doesn't have to open every field. */
  summary: string | null;
  photoCandidates: { title: string; pageUrl: string; thumbUrl: string; licenseSlug: string; artist: string }[];
  error: string | null;
}

async function researchGeneration(brand: string, model: string, wikipediaTitle: string): Promise<GenerationResearch> {
  try {
    const infobox = await fetchCarInfobox(wikipediaTitle);
    const brandWords = brand.toLowerCase().split(/\s+/);
    const haystack = `${infobox.clean.manufacturer ?? ""} ${infobox.clean.name ?? ""} ${wikipediaTitle}`.toLowerCase();
    const looksRelevant = brandWords.some((w) => haystack.includes(w));

    const summaryParts = [
      infobox.clean.production ? `Production: ${infobox.clean.production}` : null,
      infobox.clean.platform ? `Platform: ${infobox.clean.platform}` : null,
      infobox.clean.engine ? `Engines: ${infobox.clean.engine.slice(0, 200)}${infobox.clean.engine.length > 200 ? "…" : ""}` : null,
      infobox.clean.predecessor ? `Predecessor: ${infobox.clean.predecessor}` : null,
    ].filter((s): s is string => s != null);

    const photoQuery = `${brand} ${model} ${wikipediaTitle.replace(/^.*\(([^)]+)\).*$/, "$1")}`.trim();
    const photoCandidates = looksRelevant ? await searchCommonsCandidates(photoQuery, 4) : [];

    return {
      wikipediaTitle,
      looksRelevant,
      infobox: infobox.clean,
      summary: summaryParts.length > 0 ? summaryParts.join(" | ") : null,
      photoCandidates: photoCandidates.map((c) => ({
        title: c.title,
        pageUrl: c.pageUrl,
        thumbUrl: c.thumbUrl,
        licenseSlug: c.licenseSlug,
        artist: c.artist,
      })),
      error: null,
    };
  } catch (err) {
    return {
      wikipediaTitle,
      looksRelevant: false,
      infobox: null,
      summary: null,
      photoCandidates: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const [brand, model, startStr, endStr] = process.argv.slice(2);
  if (!brand || !model || !startStr || !endStr) {
    console.error('Usage: npm run research:nameplate --workspace @automotive/worker -- "<Brand>" "<Model>" <epaStartYear> <epaEndYear>');
    process.exitCode = 1;
    return;
  }
  const startYear = Number(startStr);
  const endYear = Number(endStr);

  console.error(`Fetching real EPA year-by-year trim history for ${brand} ${model} (${startYear}-${endYear})...`);
  const epaHistory = await fetchNameplateHistory(brand, model, startYear, endYear);

  console.error(`Searching Wikipedia for real "${brand} ${model}" generation articles...`);
  const candidateTitles = Array.from(
    new Set([
      ...(await searchWikipediaTitles(`"${brand} ${model}" generation`, 10)),
      ...(await searchWikipediaTitles(`${brand} ${model}`, 5)),
    ]),
  );

  console.error(`Checking ${candidateTitles.length} candidate Wikipedia pages for real infoboxes...`);
  const generations: GenerationResearch[] = [];
  for (const title of candidateTitles) {
    generations.push(await researchGeneration(brand, model, title));
    await sleep(250); // proactive spacing — fetchWikitext's own 429 retry is a backstop, not the plan
  }

  // Every candidate that returned a real infobox is reported — none
  // silently dropped, per this file's own header (a strict brand/model
  // substring filter would have discarded every real Ford F-150
  // generation article, since Wikipedia titles them "Ford F-Series
  // (Nth generation)"). `looksRelevant` is a sort hint, not a filter.
  const withInfobox = generations.filter((g) => g.infobox != null).sort((a, b) => Number(b.looksRelevant) - Number(a.looksRelevant));
  const failed = generations.filter((g) => g.infobox == null);

  const report = {
    brand,
    model,
    epaYearRange: [startYear, endYear],
    epaTrimHistory: epaHistory,
    generationCandidates: withInfobox,
    failedCandidates: failed.map((g) => ({ wikipediaTitle: g.wikipediaTitle, error: g.error })),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
