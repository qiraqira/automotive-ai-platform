import { fetchCarInfobox } from "./lib/wikipedia-car.js";

// CLI wrapper (`npm run fetch:infobox --workspace @automotive/worker -- "<Wikipedia page title>"`)
// around lib/wikipedia-car.ts's deterministic infobox parser — prints the
// cleaned field=value pairs so a session/editor can read a car's real
// production years/platform/engine list without a WebFetch call. See
// lib/wikipedia-car.ts's own header for why this exists.

async function main() {
  const pageTitle = process.argv[2];
  if (!pageTitle) {
    console.error('Usage: npm run fetch:infobox --workspace @automotive/worker -- "<Wikipedia page title>"');
    process.exitCode = 1;
    return;
  }
  const infobox = await fetchCarInfobox(pageTitle);
  console.log(JSON.stringify(infobox.clean, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
