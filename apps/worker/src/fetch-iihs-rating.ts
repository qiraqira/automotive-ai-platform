import { fetchIihsRating } from "./lib/iihs.js";

// CLI wrapper (`npm run fetch:iihs --workspace @automotive/worker -- <url>`)
// around lib/iihs.ts's deterministic parser — prints structured JSON so a
// session/editor can pull a real IIHS rating without a WebFetch call.
// See lib/iihs.ts's own header for why this exists.

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npm run fetch:iihs --workspace @automotive/worker -- <iihs-vehicle-url>");
    process.exitCode = 1;
    return;
  }
  const rating = await fetchIihsRating(url);
  console.log(JSON.stringify(rating, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
