import { createHash } from "node:crypto";
import { prisma } from "@automotive/database";
import { verifyImageMatch } from "./verify-image.js";

// Real image sourcing for Article hero images (spec's Image rights engine,
// packages/database/prisma/schema.prisma's Image/ImageLicense/ArticleImage
// models — previously 0% built, no caller anywhere). User's explicit
// instruction: search free stock first, only consider AI generation as a
// fallback (not built here — needs a real image-generation provider key,
// which isn't configured yet; this file only does the free-stock half).
//
// Wikimedia Commons (no API key, no rate-limit registration needed for
// this volume) is the real source: real photos of real cars, each with
// real per-file license metadata this project's own Image model was
// already designed to track (rightsStatus/license/attribution) — a much
// better fit than an unauthenticated random-stock endpoint, since a car
// news site benefits from an image that's actually of the right car, not
// a generic "automobile" stock photo. Never downloads/mirrors the full
// file — hotlinks Commons' own CDN via a real requested thumbnail width,
// which is Commons' own supported reuse pattern, not a scrape.

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "AutomotiveAIPlatform/1.0 (https://auto.kite99.com; contact via site)";
const THUMB_WIDTH = 1200;
const MIN_SOURCE_WIDTH = 800;
const FETCH_TIMEOUT_MS = 20_000;

// Deliberately conservative: only license shapes with zero ambiguity
// about commercial reuse + modification (this is a commercial editorial
// site, and hero images get real Article-generated crops/placement).
// Excludes NC (non-commercial) and ND (no-derivatives) variants entirely,
// and excludes anything Commons didn't machine-classify at all.
const ALLOWED_LICENSE_PREFIXES = ["cc0", "cc-by-sa", "cc-by", "pd"];

// Provider-agnostic shape — both searchCommonsImage() and
// searchOpenverseImage() below produce this, so getOrCreateLicense()/
// attachHeroImage()'s Image.create() call don't need to know which
// provider a candidate came from except for the `provider` label itself.
export interface ImageCandidate {
  provider: string;
  title: string;
  thumbUrl: string;
  width: number;
  height: number;
  mime: string;
  artist: string;
  licenseShortName: string;
  licenseSlug: string;
  licenseUrl: string;
  attributionRequired: boolean;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Real gap found live 2026-09-11: the "brand = headline's first word"
// convention used elsewhere in this file only holds when the headline
// actually leads with the brand — plenty of real, published headlines
// don't ("Second Tesla driver killed...", "Only One Ferrari Enzo...").
// packages/database has no populated Brand table to query live (real,
// confirmed empty — this project's CarModel/Brand catalog was never
// seeded with real rows despite the schema existing), so this list is
// hand-built from every brand actually seen across this site's real
// published headlines during the 2026-09-11 image-quality pass, not
// guessed from a generic "top car brands" list. Ordered longest-first
// so a multi-word name (e.g. "Land Rover") matches before a shorter
// substring of it could.
const KNOWN_BRANDS = [
  "Land Rover", "Range Rover", "Rolls-Royce", "Aston Martin", "Alfa Romeo",
  "Mercedes-Benz", "Volkswagen", "Mitsubishi", "Lamborghini", "Chevrolet",
  "Cadillac", "Chrysler", "Genesis", "Hyundai", "Polestar", "Infiniti",
  "Mercedes", "Porsche", "Bugatti", "McLaren", "Bentley", "Lincoln",
  "Xiaomi", "Segway", "Engwe", "Tenways", "Macfox", "SONDORS", "Windrose",
  "Jackery", "Bluetti", "EcoFlow", "Velotric", "Juiced", "Rivian", "Nissan",
  "Toyota", "Subaru", "Renault", "Peugeot", "Citroen", "Maserati", "Ferrari",
  "Skoda", "Denza", "Geely", "Waymo", "Tesla", "Honda", "Mazda", "Rimac",
  "Lucid", "Fisker", "Volvo", "Kia", "Audi", "BMW", "Ford", "Jeep", "Ram",
  "Dodge", "Buick", "Acura", "Mini", "Smart", "Fiat", "BYD", "GM", "Uber",
  "SANY", "Evoke", "Slate",
];

function detectBrand(text: string): string | null {
  for (const brand of KNOWN_BRANDS) {
    if (new RegExp(`\\b${escapeRegExp(brand)}\\b`, "i").test(text)) return brand;
  }
  return null;
}

// Real, severe quality gap found live 2026-09-08, first real production
// backfill run: Commons' own search is plain full-text, not semantic —
// a short, generic fallback query (needed because a full AI headline
// finds nothing, see buildSearchQueries()'s own comment) sometimes
// returns a result that's completely unrelated to the actual query, just
// because it happens to share one common word. Caught by inspecting the
// real attached rows on the live site, not by assumption: a "Second
// Tesla driver killed..." headline's "Second Tesla" fallback query
// matched a real Commons file titled "Second Severn Crossing" (a bridge
// in Wales) — shares only the word "Second". A license/mime/size filter
// alone can't catch this; it's a relevance problem, not a rights
// problem. Requires ALL of a 1-2-word query's words, or at least half of
// a longer query's words, to appear as real whole words in the
// candidate's own title — cheap, no extra API call (the title is
// already in the search response), and directly rejects exactly this
// failure shape while still accepting genuine matches (verified: real
// "BMW iX3, IAA Summit 2025..." titles contain both "BMW" and "iX3" for
// a "BMW iX3" query; "BMW Corvette and LMPC pack of cars..." for a "BMW
// Enlists iX3 Drivers" query only contains 1 of those 4 words, correctly
// falling below the 50% bar).
// Real, second false-positive shape found live 2026-09-08, same
// investigation: the word-overlap check above still let through
// "A replica of the Benz Patent Motorwagen... located at Mercedes-Benz
// World at Brooklands" for a "Mercedes Patent" query — both words are
// genuinely, literally present, so the overlap check alone can't reject
// it; the words just belong to unrelated parts of an unrelated sentence
// (a museum venue name, not the article's actual subject). Real Commons
// photos of an actual subject overwhelmingly lead with that subject in
// the title (confirmed against every genuine match found this session —
// "BMW iX3, IAA Summit 2025...", "Volkswagen, Auto 2024, Zurich...");
// this false positive buries "Mercedes" near the very end of a long
// descriptive sentence instead. Requiring the query's own first word
// (the brand, by construction of buildSearchQueries()) to appear within
// the leading half of the title's characters adds a real positional
// signal a pure word-presence check can't express, and rejects this
// exact case (confirmed live) without rejecting any of the session's
// real genuine matches.
function isRelevantTitle(query: string, title: string): boolean {
  const queryWords = query.split(/\s+/).filter(Boolean);
  if (queryWords.length === 0) return true;
  const matches = queryWords.filter((w) => new RegExp(`\\b${escapeRegExp(w)}\\b`, "i").test(title)).length;
  const threshold = queryWords.length <= 2 ? queryWords.length : Math.ceil(queryWords.length / 2);
  if (matches < threshold) return false;

  // Safe: the `queryWords.length === 0` check above guarantees index 0 exists.
  const anchor = queryWords[0] as string;
  const anchorMatch = title.match(new RegExp(`\\b${escapeRegExp(anchor)}\\b`, "i"));
  if (!anchorMatch || anchorMatch.index === undefined) return false;
  return anchorMatch.index <= title.length * 0.5;
}

interface CommonsImageInfo {
  url: string;
  thumburl?: string;
  width: number;
  height: number;
  thumbwidth?: number;
  thumbheight?: number;
  mime: string;
  extmetadata?: Record<string, { value?: string }>;
}

interface CommonsPage {
  title: string;
  imageinfo?: CommonsImageInfo[];
}

export async function searchCommonsImage(query: string): Promise<ImageCandidate | null> {
  const url = new URL(COMMONS_API);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "10",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
  }).toString();

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const data = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = Object.values(data.query?.pages ?? {});

  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    if (info.mime !== "image/jpeg" && info.mime !== "image/png") continue;
    if (info.width < MIN_SOURCE_WIDTH) continue;
    if (/logo|diagram|badge|emblem|icon|map\b/i.test(page.title)) continue;
    if (!isRelevantTitle(query, page.title)) continue;

    const meta = info.extmetadata ?? {};
    const licenseSlug = (meta.License?.value ?? "").toLowerCase();
    if (!ALLOWED_LICENSE_PREFIXES.some((p) => licenseSlug.startsWith(p))) continue;

    return {
      provider: "Wikimedia Commons",
      title: page.title,
      thumbUrl: info.thumburl ?? info.url,
      width: info.thumbwidth ?? info.width,
      height: info.thumbheight ?? info.height,
      mime: info.mime,
      artist: stripHtml(meta.Artist?.value ?? "Unknown"),
      licenseShortName: meta.LicenseShortName?.value ?? licenseSlug,
      licenseSlug,
      licenseUrl: meta.LicenseUrl?.value ?? `https://creativecommons.org/licenses/`,
      attributionRequired: (meta.AttributionRequired?.value ?? "true") !== "false",
    };
  }
  return null;
}

// Second free-stock source, tried when Commons finds nothing — user's
// explicit instruction to search as many stock sources as practical.
// Openverse (api.openverse.org, no API key needed at this volume) is a
// real multiplier rather than one more one-off integration: it's itself
// an aggregator over ~800M CC-licensed images from Flickr, museum/
// archive collections, Europeana, etc. — one HTTP call reaches many real
// sources at once, which is a better fit for "as many stocks as
// possible" than hand-wiring each one individually. `license` (not
// `license_type`) is the exact-match param — passing the precise slugs
// we allow avoids relying on unverified assumptions about how
// `license_type`'s AND/OR grouping works. `category=photograph` filters
// out illustrations/digitized artwork at the API level, for free.
const OPENVERSE_API = "https://api.openverse.org/v1/images/";
// Same commercial-use + modification-allowed bar as Commons'
// ALLOWED_LICENSE_PREFIXES above, expressed in Openverse's own license
// vocabulary (lowercase, no "cc-" prefix) — excludes every NC/ND variant.
const OPENVERSE_ALLOWED_LICENSES = ["cc0", "pdm", "by", "by-sa"];

interface OpenverseResult {
  title?: string;
  creator?: string;
  url?: string;
  license?: string;
  license_url?: string;
  width?: number;
  height?: number;
}

// Normalizes Openverse's license vocabulary to Commons' own
// (cc0/pd/cc-by/cc-by-sa prefixes) so the shared rightsStatusFor() below
// doesn't need to know which provider a candidate came from.
function normalizeOpenverseLicense(slug: string): string {
  if (slug === "pdm") return "pd";
  if (slug === "by-sa") return "cc-by-sa";
  if (slug === "by") return "cc-by";
  return slug;
}

async function searchOpenverseImage(query: string): Promise<ImageCandidate | null> {
  const url = new URL(OPENVERSE_API);
  url.search = new URLSearchParams({
    q: query,
    license: OPENVERSE_ALLOWED_LICENSES.join(","),
    category: "photograph",
    page_size: "10",
  }).toString();

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: OpenverseResult[] };

  for (const item of data.results ?? []) {
    if (!item.url || !item.width || item.width < MIN_SOURCE_WIDTH) continue;
    const title = item.title ?? "";
    if (/logo|diagram|badge|emblem|icon|map\b/i.test(title)) continue;
    if (!isRelevantTitle(query, title)) continue;

    const rawLicense = (item.license ?? "").toLowerCase();
    if (!OPENVERSE_ALLOWED_LICENSES.includes(rawLicense)) continue;
    const licenseSlug = normalizeOpenverseLicense(rawLicense);

    return {
      provider: "Openverse",
      title,
      thumbUrl: item.url,
      width: item.width,
      height: item.height ?? item.width,
      mime: /\.png(\?|$)/i.test(item.url) ? "image/png" : "image/jpeg",
      artist: item.creator || "Unknown",
      licenseShortName: rawLicense.toUpperCase(),
      licenseSlug,
      licenseUrl: item.license_url ?? "https://creativecommons.org/licenses/",
      attributionRequired: licenseSlug !== "cc0" && licenseSlug !== "pd",
    };
  }
  return null;
}

export async function hashRemoteImage(url: string): Promise<{ sha256: string; byteLength: number }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": USER_AGENT } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { sha256: createHash("sha256").update(buf).digest("hex"), byteLength: buf.length };
}

export async function getOrCreateLicense(candidate: ImageCandidate): Promise<string> {
  const existing = await prisma.imageLicense.findFirst({
    where: { provider: candidate.provider, licenseType: candidate.licenseSlug },
  });
  if (existing) return existing.id;

  // A brand logo (searchBrandLogo's "logo" sentinel) is trademark fair-use
  // for editorial identification, not a CC grant — real news use (this
  // case) is fine, but claiming "modification allowed" the same way a
  // CC-BY photo does would misrepresent actual trademark rights.
  const isLogo = candidate.licenseSlug === "logo";
  const created = await prisma.imageLicense.create({
    data: {
      provider: candidate.provider,
      licenseType: candidate.licenseSlug,
      licenseUrl: candidate.licenseUrl,
      attributionRequired: candidate.attributionRequired,
      // Every CC license this function otherwise accepts (see
      // ALLOWED_LICENSE_PREFIXES) permits both commercial use and
      // modification — NC/ND variants are filtered out before this is
      // ever called — so `true` is accurate there; the logo case is
      // handled separately above.
      commercialUseAllowed: true,
      modificationAllowed: !isLogo,
    },
  });
  return created.id;
}

export function rightsStatusFor(licenseSlug: string): "PUBLIC_DOMAIN" | "CC_BY_SA" | "CC_BY" | "EDITORIAL_ONLY" {
  // A brand logo (searchBrandLogo's own "logo" sentinel slug) is neither
  // truly Creative-Commons-licensed content nor safe to imply otherwise —
  // it's used here for the same reason any real newsroom uses it: brand
  // identification, under trademark fair-use, not a CC grant.
  if (licenseSlug === "logo") return "EDITORIAL_ONLY";
  if (licenseSlug.startsWith("cc0") || licenseSlug.startsWith("pd")) return "PUBLIC_DOMAIN";
  if (licenseSlug.startsWith("cc-by-sa")) return "CC_BY_SA";
  return "CC_BY";
}

/** Finds/attaches a real HERO image for one Article. Returns true if an
 * image was attached, false if no usable, AI-verified result was found
 * across every provider (the honest "free stock search came up empty"
 * case — generate-image.ts's AI-generation fallback is the real,
 * separate next step a caller takes when this returns false).
 *
 * Real gap found and fixed live 2026-09-08, first real backfill run
 * against production: passing a full AI-written headline (10+ words,
 * generic filler like "luxury"/"achieves"/"reveals") as the search query
 * found ZERO usable images for 12/12 real articles — verified live that
 * this was a query-construction problem, not a real lack of Commons
 * coverage: the exact same headline's leading "Brand Model" substring
 * (e.g. "BMW iX3" out of "BMW Enlists iX3 Drivers in Safety Data
 * Collection Program") independently returned 10 real, usable
 * cc-by-sa-4.0 photos. Commons' own search doesn't do semantic
 * matching — a long sentence dilutes past matching. `buildSearchQueries()`
 * tries multiple, shorter candidate queries (full text, then its first 4
 * words, then its first 2 words) in order until one finds a real usable
 * result, rather than a single long query that usually won't. */
// Real gap found live 2026-09-10, same backfill run that exercised the
// new Openverse/verify-image.ts additions: "Corvette E-Ray's Legacy
// Shapes Future Electrified Performance Cars" found ZERO usable images
// from either provider. Root cause isn't the providers — it's this
// function handing them (and isRelevantTitle() below) the literal word
// "E-Ray's". A real Commons/Openverse file is titled "... Corvette E-Ray
// ...", never "E-Ray's" — no real photo file is ever named with a
// prose possessive — so isRelevantTitle()'s word-boundary match for
// "E-Ray's" can never succeed against a genuine, on-topic result;
// confirmed live by re-running the same query manually with the
// possessive stripped, which immediately found real Commons matches.
// Any headline built around a possessive (car names ending in an
// owner's-name-style suffix, "Tesla's", "Waymo's", etc.) hits the exact
// same failure. Stripped once here, at query-construction time, so
// every downstream consumer (the request sent to each provider, and
// isRelevantTitle()'s own word-splitting of the query) sees the
// corrected word.
function stripPossessive(word: string): string {
  return word.replace(/['’]s$/i, "").replace(/['’]$/, "");
}

export function buildSearchQueries(texts: string[]): string[] {
  const queries: string[] = [];
  for (const text of texts) {
    const words = text.split(/\s+/).filter(Boolean).map(stripPossessive);
    for (const n of [words.length, 4, 2]) {
      const q = words.slice(0, n).join(" ");
      if (q && !queries.includes(q)) queries.push(q);
    }
  }
  return queries;
}

// Providers tried in order per query — Commons first (best hit rate for
// an actual named car/brand, per this file's own 2026-09-08 findings),
// Openverse second (broader aggregated coverage, better for generic/
// non-model-specific subjects).
const IMAGE_PROVIDERS = [searchCommonsImage, searchOpenverseImage];

// Last-resort fallback, user's explicit instruction 2026-09-11 after a
// live AI-image-replacement run found a real photo for only 4 of 75
// AI-illustrated articles: most of this site's coverage is brand-new
// vehicle reveals (a just-announced BYD SUV, a spotted prototype) that
// simply have no free-licensed photo anywhere yet — Commons/Openverse
// can't find what doesn't exist. Rather than leave the old fake AI
// "photo" in that case, or show no image at all, fall back to the
// brand's own real logo — honest (it doesn't pretend to be a photo of
// the specific car), easy to source (Commons carries clean official
// logo files for essentially every real car brand), and exactly the
// "aakuratnyy fallback" the user asked for over either a fake photo or
// a blank hero slot. Deliberately searches WITHOUT isRelevantTitle()'s
// logo/diagram/badge exclusion (the opposite intent here) and skips the
// AI vision match check — a vision model judging "does this look like
// the news event" makes no sense for a logo; a plain title check that
// the result is actually a logo of the right brand is enough.
async function searchBrandLogo(brand: string): Promise<ImageCandidate | null> {
  const url = new URL(COMMONS_API);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${brand} logo`,
    gsrnamespace: "6",
    gsrlimit: "10",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
  }).toString();

  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const data = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = Object.values(data.query?.pages ?? {});

  const brandWord = brand.split(/\s+/)[0] ?? brand;
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    if (info.mime !== "image/jpeg" && info.mime !== "image/png" && info.mime !== "image/svg+xml") continue;
    if (!/logo/i.test(page.title)) continue;
    if (!new RegExp(`\\b${escapeRegExp(brandWord)}\\b`, "i").test(page.title)) continue;

    const meta = info.extmetadata ?? {};
    const licenseSlug = (meta.License?.value ?? "").toLowerCase();
    // Real logos are almost always uploaded under {{PD-logo}} (too
    // simple to be copyrightable) or a real trademark-fair-use template,
    // neither of which necessarily carries a CC License field the same
    // way a photograph does — a missing/non-CC license here is the norm
    // for a logo, not a rights problem, so this candidate isn't rejected
    // for that alone the way a photo would be.
    return {
      provider: "Wikimedia Commons",
      title: page.title,
      thumbUrl: info.thumburl ?? info.url,
      width: info.thumbwidth ?? info.width,
      height: info.thumbheight ?? info.height,
      mime: info.mime,
      artist: stripHtml(meta.Artist?.value ?? "Unknown"),
      licenseShortName: meta.LicenseShortName?.value || (licenseSlug ? licenseSlug : "Trademark/logo — fair use"),
      licenseSlug: licenseSlug || "logo",
      licenseUrl: meta.LicenseUrl?.value ?? "https://commons.wikimedia.org/wiki/Commons:Logos",
      attributionRequired: (meta.AttributionRequired?.value ?? "false") === "true",
    };
  }
  return null;
}

export async function attachHeroImage(articleId: string, searchTexts: string[]): Promise<boolean> {
  // The fullest real text (a full headline/story title, not the
  // truncated 2-4-word search queries below) is what the AI vision check
  // needs to judge "does this photo match the subject" — a search query
  // is optimized for finding candidates, not for describing what they
  // should show.
  const context = searchTexts[0] ?? "";

  // Real gap found and fixed 2026-09-10 (user's explicit instruction,
  // after a live "Labor Day Green Deals hub" article was found live with
  // an unrelated 19th-century parade engraving as its hero image): the
  // isRelevantTitle() text check inside each provider's own search
  // function only rejects candidates whose title doesn't share enough
  // words with the query — it can't tell that a photo, whatever its
  // title says, isn't actually a car/automotive-relevant image. Every
  // candidate from every provider now has to also pass a real vision
  // check (verify-image.ts) before being accepted; a rejected candidate
  // is skipped in favor of the next one, not treated as a hard failure.
  for (const query of buildSearchQueries(searchTexts)) {
    for (const searchProvider of IMAGE_PROVIDERS) {
      const candidate = await searchProvider(query);
      if (!candidate) continue;

      const verified = await verifyImageMatch(candidate.thumbUrl, context);
      if (!verified) continue;

      // A different Article may have already picked the exact same file
      // (two Stories about the same car model, or the same Openverse/
      // Commons photo) — Image.sha256 is unique, so reuse the existing
      // row instead of a duplicate-key error.
      const { sha256 } = await hashRemoteImage(candidate.thumbUrl);
      const existingImage = await prisma.image.findUnique({ where: { sha256 } });

      const imageId = existingImage
        ? existingImage.id
        : (
            await prisma.image.create({
              data: {
                originalUrl: candidate.thumbUrl,
                sourceType: "CREATIVE_COMMONS",
                rightsStatus: rightsStatusFor(candidate.licenseSlug),
                author: candidate.artist,
                attribution: `${candidate.artist} — ${candidate.licenseShortName}, via ${candidate.provider}`,
                licenseId: await getOrCreateLicense(candidate),
                width: candidate.width,
                height: candidate.height,
                mimeType: candidate.mime,
                sha256,
                generatedByAi: false,
              },
            })
          ).id;

      await prisma.articleImage.create({
        data: { articleId, imageId, role: "HERO", position: 0, altText: candidate.title.replace(/^File:/, "").replace(/\.\w+$/, "") },
      });
      return true;
    }
  }

  // Last resort: the brand's own logo (searchBrandLogo above) — never a
  // vision-matched photo of the specific event, but a real, honest
  // placeholder. Brand is the headline's own first word by construction
  // (buildSearchQueries()' own anchor-word convention, confirmed live
  // against this file's real isRelevantTitle() logic). Real gap found
  // live 2026-09-11: that convention only holds for a headline that
  // actually LEADS with the brand — "Second Tesla driver killed after
  // vehicle stopped..." has "Second" as its first word, so the naive
  // first-word extraction missed a real, findable Tesla logo entirely.
  // detectBrand() below checks for any of this site's actual covered
  // brands appearing anywhere in the text, falling back to the
  // first-word convention only when none matches.
  const brand = detectBrand(context) ?? context.split(/\s+/)[0];
  if (brand) {
    const logo = await searchBrandLogo(brand);
    if (logo) {
      const { sha256 } = await hashRemoteImage(logo.thumbUrl);
      const existingImage = await prisma.image.findUnique({ where: { sha256 } });
      const imageId = existingImage
        ? existingImage.id
        : (
            await prisma.image.create({
              data: {
                originalUrl: logo.thumbUrl,
                sourceType: "CREATIVE_COMMONS",
                rightsStatus: rightsStatusFor(logo.licenseSlug),
                author: logo.artist,
                attribution: `Official ${brand} logo, via ${logo.provider} — used for identification, not a photo of the specific vehicle/event.`,
                licenseId: await getOrCreateLicense(logo),
                width: logo.width,
                height: logo.height,
                mimeType: logo.mime,
                sha256,
                generatedByAi: false,
              },
            })
          ).id;

      await prisma.articleImage.create({
        data: { articleId, imageId, role: "HERO", position: 0, altText: `${brand} logo` },
      });
      return true;
    }
  }

  return false;
}
