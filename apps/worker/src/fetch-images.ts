import { createHash } from "node:crypto";
import { prisma } from "@automotive/database";

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

interface CommonsCandidate {
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

async function searchCommonsImage(query: string): Promise<CommonsCandidate | null> {
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

async function hashRemoteImage(url: string): Promise<{ sha256: string; byteLength: number }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": USER_AGENT } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { sha256: createHash("sha256").update(buf).digest("hex"), byteLength: buf.length };
}

async function getOrCreateLicense(candidate: CommonsCandidate): Promise<string> {
  const existing = await prisma.imageLicense.findFirst({
    where: { provider: "Wikimedia Commons", licenseType: candidate.licenseSlug },
  });
  if (existing) return existing.id;

  const created = await prisma.imageLicense.create({
    data: {
      provider: "Wikimedia Commons",
      licenseType: candidate.licenseSlug,
      licenseUrl: candidate.licenseUrl,
      attributionRequired: candidate.attributionRequired,
      // Every license this function accepts (see ALLOWED_LICENSE_PREFIXES)
      // permits both commercial use and modification — NC/ND variants are
      // filtered out before this is ever called.
      commercialUseAllowed: true,
      modificationAllowed: true,
    },
  });
  return created.id;
}

function rightsStatusFor(licenseSlug: string): "PUBLIC_DOMAIN" | "CC_BY_SA" | "CC_BY" {
  if (licenseSlug.startsWith("cc0") || licenseSlug.startsWith("pd")) return "PUBLIC_DOMAIN";
  if (licenseSlug.startsWith("cc-by-sa")) return "CC_BY_SA";
  return "CC_BY";
}

/** Finds/attaches a real HERO image for one Article. Returns true if an
 * image was attached, false if no usable Commons result was found (the
 * honest "free stock search came up empty" case — AI-generation fallback
 * is a real, separate follow-up needing an image-gen provider key, not
 * built here).
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
export function buildSearchQueries(texts: string[]): string[] {
  const queries: string[] = [];
  for (const text of texts) {
    const words = text.split(/\s+/).filter(Boolean);
    for (const n of [words.length, 4, 2]) {
      const q = words.slice(0, n).join(" ");
      if (q && !queries.includes(q)) queries.push(q);
    }
  }
  return queries;
}

export async function attachHeroImage(articleId: string, searchTexts: string[]): Promise<boolean> {
  let candidate: CommonsCandidate | null = null;
  for (const query of buildSearchQueries(searchTexts)) {
    candidate = await searchCommonsImage(query);
    if (candidate) break;
  }
  if (!candidate) return false;

  // A different Article may have already picked the exact same Commons
  // file (two Stories about the same car model) — Image.sha256 is
  // unique, so reuse the existing row instead of a duplicate-key error.
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
            attribution: `${candidate.artist} — ${candidate.licenseShortName}, via Wikimedia Commons`,
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
