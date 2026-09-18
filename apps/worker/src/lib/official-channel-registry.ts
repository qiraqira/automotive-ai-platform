// Verified real YouTube channel IDs for manufacturer "official" channels
// (the specific regional/US channel, not a global or non-US one — e.g.
// the generic "@toyota" handle resolves to Toyota Deutschland, not
// Toyota USA, found and corrected 2026-09-18 while building this
// registry). Each entry is confirmed by fetching `https://www.youtube.com/@<handle>`
// and reading the page's own `<link rel="canonical" href="https://www.youtube.com/channel/UC...">`
// tag — NOT the first `"externalId":"UC..."` match in the page source,
// which can belong to an unrelated suggested/sidebar channel and silently
// resolve to the wrong ID (real bug found and fixed 2026-09-18: this
// table's own "honda", "tesla", "ford", "dodge", and "hyundai" entries
// had all been mis-resolved that way, pointing at Acura, "Tesla
// Tutorials", "Ford Racing", "Stellantis North America", and
// "HyundaiWorldwide" respectively — never caught in any published
// CarVideo row only because add-car-video.ts's own oEmbed check on the
// specific candidate video is a second, independent verification that
// doesn't trust this table at all, but it did mean several `find:car-video`
// calls were silently searching the wrong channel's uploads all session).
// Extend this table using the canonical-link method, never the raw
// externalId grep, and never guess a channel ID.
export const OFFICIAL_CHANNELS: Record<string, { handle: string; channelId: string; label: string }> = {
  tesla: { handle: "@tesla", channelId: "UC5WjFrtBdufl6CZojX3D8dQ", label: "Tesla" },
  ford: { handle: "@ford", channelId: "UCKA96UxTdgFBwGZMGZ-135w", label: "Ford Motor Company" },
  chevrolet: { handle: "@chevrolet", channelId: "UCSVpCNZzOeMekuMiFze3fnQ", label: "Chevrolet" },
  dodge: { handle: "@dodge", channelId: "UC6NMqrESrKioKr9axv_YM7w", label: "Dodge" },
  toyota: { handle: "@toyotausa", channelId: "UC1pOTJteEef10zJM0cHs4iQ", label: "Toyota USA" },
  honda: { handle: "@honda", channelId: "UC22zQ9nBEk6KOjUWqR5XXZg", label: "Honda" },
  hyundai: { handle: "@hyundai", channelId: "UCx_eAZKDceT1yaY4bRo636A", label: "HyundaiUSA" },
  mazda: { handle: "@mazdausa", channelId: "UC0Ihuy4gj2w-AYEQXRnUdUA", label: "Mazda USA" },
  subaru: { handle: "@subaru", channelId: "UCw0N2zPZlYsrUcVIJkI6mBA", label: "Subaru" },
  ram: { handle: "@ramtrucks", channelId: "UCNfZNOb3jq-iWdL0d9OMf9Q", label: "Ram Trucks" },
  porsche: { handle: "@porsche", channelId: "UC_BaxRhNREI_V0DVXjXDALA", label: "Porsche" },
  volkswagen: { handle: "@volkswagen", channelId: "UC0US_GEXVmwMH04OMcNuhpQ", label: "Volkswagen" },
  kia: { handle: "@kia", channelId: "UCbp3o7U6oSa6s-LQBZvOnGg", label: "Kia America" },
  chrysler: { handle: "@chrysler", channelId: "UCTrYqPWfAOku2Wkdxer4DRQ", label: "Chrysler" },
  bmw: { handle: "@BMW", channelId: "UCYwrS5QvBY_JbSdbINLey6Q", label: "BMW" },
  "mercedes-benz": { handle: "@MercedesBenz", channelId: "UClj0L8WZrVydk5xKOscI6-A", label: "Mercedes-Benz" },
  audi: { handle: "@Audi", channelId: "UCO5ujNeWRIwP4DbCZqZWcLw", label: "Audi" },
  lexus: { handle: "@lexus", channelId: "UCEDHfFp2GZonrhuAaz7VjPw", label: "Lexus" },
  acura: { handle: "@acura", channelId: "UCxl79GCsb6-xhrdQuPgnuJA", label: "Acura" },
};

interface FeedEntry {
  videoId: string;
  title: string;
  url: string;
}

// YouTube's public per-channel RSS feed — real, deterministic, no API
// key, but only ever returns the channel's ~15 most recent uploads (no
// pagination), so a model whose own dedicated video has scrolled off
// that window won't be found this way and needs a manual WebSearch +
// oEmbed-verify fallback instead (see docs/content-standards.md).
export async function fetchChannelFeed(channelId: string): Promise<FeedEntry[]> {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    headers: { "User-Agent": "AutomotiveAIPlatform/1.0 (https://autonewsfeed.com)" },
  });
  if (!res.ok) throw new Error(`feed fetch failed: ${res.status}`);
  const xml = await res.text();
  const entries: FeedEntry[] = [];
  for (const m of xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)) {
    const block = m[0];
    const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = block.match(/<title>([^<]*)<\/title>/)?.[1];
    const url = block.match(/<link rel="alternate" href="([^"]+)"/)?.[1];
    if (videoId && title && url) entries.push({ videoId, title, url });
  }
  return entries;
}

// Confirms a candidate video is really hosted by the channel we think it
// is (YouTube's public oEmbed endpoint, no API key) — the concrete check
// content-standards.md's "Video" section requires before ever trusting a
// title like "Official Reveal" at face value.
export async function verifyVideoAuthor(videoId: string): Promise<{ authorName: string; title: string } | null> {
  const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
  if (!res.ok) return null;
  const data = (await res.json()) as { author_name?: string; title?: string };
  if (!data.author_name || !data.title) return null;
  return { authorName: data.author_name, title: data.title };
}
