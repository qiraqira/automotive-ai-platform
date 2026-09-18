// Verified real YouTube channel IDs for manufacturer "official" channels
// (the specific regional/US channel, not a global or non-US one — e.g.
// the generic "@toyota" handle resolves to Toyota Deutschland, not
// Toyota USA, found and corrected 2026-09-18 while building this
// registry). Each entry was confirmed by fetching the channel page
// itself and reading its real og:title/externalId, not guessed.
//
// This exists so future video-sourcing work (comparison articles,
// CarVideo backfills) can go straight to `find-official-car-video.ts`
// instead of re-resolving handles by hand each time — the token-saving
// "write the mechanism once" pattern this project's memory calls for.
// Extend this table (via the same WebFetch/curl "@handle" -> externalId
// lookup) before adding a brand not listed here — never guess a channel
// ID.
export const OFFICIAL_CHANNELS: Record<string, { handle: string; channelId: string; label: string }> = {
  tesla: { handle: "@tesla", channelId: "UCr7nsg_hE_t06057x51g_Fg", label: "Tesla" },
  ford: { handle: "@ford", channelId: "UC87j_-SIjbzUqlY8tuKlZyQ", label: "Ford Motor Company" },
  chevrolet: { handle: "@chevrolet", channelId: "UCSVpCNZzOeMekuMiFze3fnQ", label: "Chevrolet" },
  dodge: { handle: "@dodge", channelId: "UCsxsyssioAZGzMHGeFxM7lw", label: "Dodge" },
  toyota: { handle: "@toyotausa", channelId: "UC1pOTJteEef10zJM0cHs4iQ", label: "Toyota USA" },
  honda: { handle: "@honda", channelId: "UCxl79GCsb6-xhrdQuPgnuJA", label: "Honda" },
  hyundai: { handle: "@hyundai", channelId: "UC5f97D60yHa7UE9rFfbej8g", label: "HyundaiUSA" },
  mazda: { handle: "@mazdausa", channelId: "UC0Ihuy4gj2w-AYEQXRnUdUA", label: "Mazda USA" },
  subaru: { handle: "@subaru", channelId: "UCw0N2zPZlYsrUcVIJkI6mBA", label: "Subaru" },
  ram: { handle: "@ramtrucks", channelId: "UCNfZNOb3jq-iWdL0d9OMf9Q", label: "Ram Trucks" },
  porsche: { handle: "@porsche", channelId: "UC_BaxRhNREI_V0DVXjXDALA", label: "Porsche" },
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
