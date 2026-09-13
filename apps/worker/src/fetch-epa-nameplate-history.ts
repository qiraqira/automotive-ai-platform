import { fetchNameplateHistory } from "./lib/epa-fuel-economy.js";

// CLI wrapper (`npm run fetch:epa-history --workspace @automotive/worker
// -- <make> <nameplate-substring> <startYear> <endYear>`) around
// lib/epa-fuel-economy.ts's fetchNameplateHistory() — prints every real
// EPA-listed model-name variant per year across a range, so a session
// can see the complete real trim/generation lineup for a nameplate
// (including years where a make files each trim as its own model
// string, e.g. BMW's X5) before writing catalog data, instead of
// guessing how many generations/trims existed.
//
// Example: npm run fetch:epa-history --workspace @automotive/worker --
// BMW X5 1999 2026

async function main() {
  const [make, nameplate, startStr, endStr] = process.argv.slice(2);
  if (!make || !nameplate || !startStr || !endStr) {
    console.error('Usage: npm run fetch:epa-history --workspace @automotive/worker -- "<make>" "<nameplate>" <startYear> <endYear>');
    process.exitCode = 1;
    return;
  }
  const history = await fetchNameplateHistory(make, nameplate, Number(startStr), Number(endStr));
  console.log(JSON.stringify(history, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
