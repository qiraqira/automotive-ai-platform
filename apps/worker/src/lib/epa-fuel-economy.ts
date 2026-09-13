import { XMLParser } from "fast-xml-parser";

// Deterministic EPA fueleconomy.gov client — no LLM call, no WebFetch
// summarization, and no Cloudflare/bot-blocking to fight (this is a
// plain public REST/XML API, not a rendered dealer or car-shopping
// site). User's own explicit ask (2026-09-14): find a real, legal, bulk
// source for vehicle specs rather than researching one model at a time
// through search results. fueleconomy.gov is run by the US EPA/DOE,
// covers every model year back to 1984 for the whole US market, and its
// data is explicitly public — this is the single most authoritative,
// structured source available for exact engine/transmission/drivetrain
// and EPA-certified fuel economy figures, better than scraping a retail
// site's own rendered trim page (which this session has already caught
// returning garbled, self-contradictory numbers once this session, for
// the Tesla Model 3).
//
// It does NOT carry horsepower/torque or MSRP — those still come from
// Wikipedia (lib/wikipedia-car.ts) and a live retail source respectively.
// This is the fuel-economy/engine-configuration leg of the three-source
// split this project now uses: Wikipedia for generation history and
// engine lineup, EPA for exact certified fuel economy per configuration,
// a live retail source (via WebFetch) for current-year US pricing.

const BASE = "https://www.fueleconomy.gov/ws/rest/vehicle";
const parser = new XMLParser();

export interface EpaMenuOption {
  value: string; // the vehicle id to pass to fetchEpaVehicle()
  text: string; // e.g. "Auto (AV-S10), 4 cyl, 2.0 L, SIDI & PFI"
}

/** Lists every real EPA "model" string for a make in a given year — real-world
 * discovery (2026-09-14, BMW X5): EPA doesn't always file trims as sub-options
 * of one base model name the way "Toyota"/"Corolla" does. For some makes each
 * trim is its own full model string per year instead (e.g. year 2007's list
 * includes "X5 3.0si" and "X5 4.8i" as two separate models, not "X5" with two
 * options) — this is the reliable way to discover every real trim name that
 * actually existed for a nameplate in a given year, and, combined with a year
 * range, the complete real lineup across a nameplate's whole history without
 * having to already know the trim names in advance. */
export async function fetchEpaModelsForMakeYear(year: number, make: string): Promise<string[]> {
  const url = `${BASE}/menu/model?year=${year}&make=${encodeURIComponent(make)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`EPA model-list fetch failed (${res.status}) for ${make} ${year}`);
  const xml = await res.text();
  const parsed = parser.parse(xml) as { menuItems?: { menuItem?: { value: string } | { value: string }[] } };
  const items = parsed.menuItems?.menuItem;
  if (!items) return [];
  const list = Array.isArray(items) ? items : [items];
  return list.map((item) => String(item.value));
}

/** Every real EPA model-name string containing `nameplateSubstring` (case-insensitive),
 * across every year in [startYear, endYear] — e.g. fetchNameplateHistory("BMW", "X5", 1999, 2026)
 * returns { 1999: [], 2000: ["X5"], ..., 2007: ["X5 3.0si", "X5 4.8i"], ... }. One HTTP call
 * per year; makes/years fueleconomy.gov has nothing for simply come back as an empty array,
 * not an error, so a full range can be swept without checking existence first. */
export async function fetchNameplateHistory(
  make: string,
  nameplateSubstring: string,
  startYear: number,
  endYear: number,
): Promise<Record<number, string[]>> {
  const result: Record<number, string[]> = {};
  for (let year = startYear; year <= endYear; year++) {
    const models = await fetchEpaModelsForMakeYear(year, make);
    const matches = models.filter((m) => m.toLowerCase().includes(nameplateSubstring.toLowerCase()));
    if (matches.length > 0) result[year] = matches;
  }
  return result;
}

/** Lists every distinct engine/transmission configuration EPA has on file for a given
 * year/make/model — e.g. fetchEpaOptions(2024, "Toyota", "Corolla"). */
export async function fetchEpaOptions(year: number, make: string, model: string): Promise<EpaMenuOption[]> {
  const url = `${BASE}/menu/options?year=${year}&make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`EPA options fetch failed (${res.status}) for ${make} ${model} ${year}`);
  const xml = await res.text();
  const parsed = parser.parse(xml) as { menuItems?: { menuItem?: EpaMenuOption | EpaMenuOption[] } };
  const items = parsed.menuItems?.menuItem;
  if (!items) return [];
  const list = Array.isArray(items) ? items : [items];
  return list.map((item) => ({ value: String(item.value), text: String(item.text) }));
}

export interface EpaVehicleRecord {
  id: string;
  make: string;
  model: string;
  year: string;
  cylinders: string;
  displ: string; // liters
  drive: string; // e.g. "Front-Wheel Drive"
  trany: string; // e.g. "Automatic (AV-S10)"
  fuelType1: string;
  city08: string; // city mpg
  highway08: string; // highway mpg
  comb08: string; // combined mpg
  co2TailpipeGpm: string; // grams CO2 per mile
  VClass: string; // EPA vehicle class
  sCharger: string; // "S" if supercharged, else empty
  tCharger: string; // "T" if turbocharged, else empty
}

/** Fetches one full EPA vehicle record by the id returned from fetchEpaOptions(). */
export async function fetchEpaVehicle(id: string): Promise<EpaVehicleRecord> {
  const res = await fetch(`${BASE}/${id}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`EPA vehicle fetch failed (${res.status}) for id ${id}`);
  const xml = await res.text();
  const parsed = parser.parse(xml) as { vehicle: Record<string, unknown> };
  const v = parsed.vehicle;
  const str = (key: string) => (v[key] === undefined || v[key] === null ? "" : String(v[key]));
  return {
    id: str("id"),
    make: str("make"),
    model: str("model"),
    year: str("year"),
    cylinders: str("cylinders"),
    displ: str("displ"),
    drive: str("drive"),
    trany: str("trany"),
    fuelType1: str("fuelType1"),
    city08: str("city08"),
    highway08: str("highway08"),
    comb08: str("comb08"),
    co2TailpipeGpm: str("co2TailpipeGpm"),
    VClass: str("VClass"),
    sCharger: str("sCharger"),
    tCharger: str("tCharger"),
  };
}

/** Convenience: every full vehicle record for a given year/make/model in one call. */
export async function fetchEpaVehiclesForModelYear(year: number, make: string, model: string): Promise<EpaVehicleRecord[]> {
  const options = await fetchEpaOptions(year, make, model);
  const vehicles: EpaVehicleRecord[] = [];
  for (const opt of options) {
    vehicles.push(await fetchEpaVehicle(opt.value));
  }
  return vehicles;
}
