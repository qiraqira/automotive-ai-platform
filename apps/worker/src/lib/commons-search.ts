// Multi-candidate Wikimedia Commons search — a deliberately looser
// sibling of fetch-images.ts's searchCommonsImage(), which returns only
// the single first license-clean match (right for the automated hero-
// image pipeline). This one returns several real candidates so a
// session can look at each one directly before picking (this project's
// own established "a person actually saw it" rule) instead of trusting
// the first automated match — built for research-nameplate.ts's own
// per-generation photo-candidate gathering.

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "AutomotiveAIPlatform/1.0 (https://auto.kite99.com; contact via site)";
const ALLOWED_LICENSE_PREFIXES = ["cc0", "cc-by-sa", "cc-by", "pd"];

export interface CommonsCandidate {
  title: string;
  pageUrl: string;
  thumbUrl: string;
  fullUrl: string;
  width: number;
  height: number;
  licenseSlug: string;
  licenseShortName: string;
  licenseUrl: string;
  artist: string;
  attributionRequired: boolean;
}

interface CommonsImageInfo {
  url: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  width: number;
  height: number;
  mime: string;
  extmetadata?: Record<string, { value: string }>;
}
interface CommonsPage {
  title: string;
  imageinfo?: CommonsImageInfo[];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export async function searchCommonsCandidates(query: string, limit = 6): Promise<CommonsCandidate[]> {
  const url = new URL(COMMONS_API);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(Math.max(limit * 2, 10)), // over-fetch since some will fail the license/type filter
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "800",
  }).toString();

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return [];
  const data = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = Object.values(data.query?.pages ?? {});

  const candidates: CommonsCandidate[] = [];
  for (const page of pages) {
    if (candidates.length >= limit) break;
    const info = page.imageinfo?.[0];
    if (!info) continue;
    if (info.mime !== "image/jpeg" && info.mime !== "image/png") continue;
    if (/logo|diagram|badge|emblem|icon|\bmap\b/i.test(page.title)) continue;
    const meta = info.extmetadata ?? {};
    const licenseSlug = (meta.License?.value ?? "").toLowerCase();
    if (!ALLOWED_LICENSE_PREFIXES.some((p) => licenseSlug.startsWith(p))) continue;

    candidates.push({
      title: page.title,
      pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
      thumbUrl: info.thumburl ?? info.url,
      fullUrl: info.url,
      width: info.width,
      height: info.height,
      licenseSlug,
      licenseShortName: meta.LicenseShortName?.value ?? licenseSlug,
      licenseUrl: meta.LicenseUrl?.value ?? "https://creativecommons.org/licenses/",
      artist: stripHtml(meta.Artist?.value ?? "Unknown"),
      attributionRequired: (meta.AttributionRequired?.value ?? "true") !== "false",
    });
  }
  return candidates;
}
