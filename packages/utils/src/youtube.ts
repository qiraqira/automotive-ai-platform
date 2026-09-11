// Car-page video embeds (user's own ask: official manufacturer videos and
// crash-test videos on a model's page) are curated by a human editor
// pasting a real YouTube URL, not auto-fetched via the YouTube Data API —
// this project has no API key configured for that, and a pasted, editor-
// verified link matches the same "real, not fabricated" bar the Image
// model's rights fields already hold ingested photos to. This just needs
// to pull the actual 11-character video ID back out of whatever URL shape
// the editor pastes in, since that ID (not the URL) is what an embed
// iframe and a stored `sourceUrl` cross-check both need.

const YOUTUBE_ID_RE = /^[\w-]{11}$/;

// Every real shape YouTube itself produces when a person shares/copies a
// video link: the two watch-page forms (with or without extra query
// params after `v=`), the short youtu.be link, and the two page types
// that embed a ready-made ID directly in the path (`/embed/`, `/shorts/`).
export function extractYoutubeId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  let candidate: string | null = null;

  if (host === "youtu.be") {
    candidate = parsed.pathname.slice(1).split("/")[0] ?? null;
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (parsed.pathname === "/watch") {
      candidate = parsed.searchParams.get("v");
    } else {
      const match = parsed.pathname.match(/^\/(embed|shorts)\/([^/]+)/);
      candidate = match?.[2] ?? null;
    }
  }

  return candidate && YOUTUBE_ID_RE.test(candidate) ? candidate : null;
}
