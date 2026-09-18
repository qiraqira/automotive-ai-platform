import { OFFICIAL_CHANNELS, fetchChannelFeed, verifyVideoAuthor } from "./lib/official-channel-registry.js";

// Deterministic, no-token-cost first pass for finding a real official
// video for a car model (`npm run find:car-video --workspace
// @automotive/worker -- <brandSlug> <model keyword> [<model keyword2> ...]`).
// Fetches the brand's real official-channel RSS feed (see
// lib/official-channel-registry.ts) and lists any recent upload whose
// title matches ALL given keywords, each re-verified via oEmbed so the
// output can be trusted without a second manual check.
//
// This only searches the channel's ~15 most recent uploads — a real
// limitation of YouTube's public RSS feed (no pagination, no search).
// A model with no hit here isn't necessarily video-less; it just means
// this cheap pass didn't find one and a manual WebSearch + oEmbed-verify
// pass (same standard) is the fallback, same as every video use before
// this script existed.
async function main() {
  const [brandSlug, ...keywords] = process.argv.slice(2);
  const channel = brandSlug ? OFFICIAL_CHANNELS[brandSlug] : undefined;
  if (!channel || keywords.length === 0) {
    console.error(`Usage: npm run find:car-video --workspace @automotive/worker -- <brandSlug> <keyword> [<keyword2> ...]`);
    console.error(`Known brands: ${Object.keys(OFFICIAL_CHANNELS).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Searching ${channel.label}'s recent uploads for: ${keywords.join(" + ")}\n`);
  const entries = await fetchChannelFeed(channel.channelId);
  const needles = keywords.map((k) => k.toLowerCase());
  const hits = entries.filter((e) => needles.every((n) => e.title.toLowerCase().includes(n)));

  if (hits.length === 0) {
    console.log(`No match in the ${entries.length} most recent uploads. Fall back to manual WebSearch + oEmbed-verify.`);
    return;
  }

  for (const hit of hits) {
    const verified = await verifyVideoAuthor(hit.videoId);
    const authorOk = verified?.authorName === channel.label;
    console.log(`${authorOk ? "VERIFIED" : "MISMATCH"} — "${hit.title}" (${hit.videoId})`);
    console.log(`  ${hit.url}`);
    console.log(`  oEmbed author: ${verified?.authorName ?? "(fetch failed)"} ${authorOk ? "== expected" : "!= expected \"" + channel.label + "\""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
