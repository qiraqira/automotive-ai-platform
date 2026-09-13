import { fetchEpaVehiclesForModelYear } from "./lib/epa-fuel-economy.js";

// CLI wrapper (`npm run fetch:epa-mpg --workspace @automotive/worker --
// <year> <make> <model>`) around lib/epa-fuel-economy.ts — prints every
// EPA-certified configuration's real engine/transmission/fuel-economy
// data as JSON. See that file's own header for why this exists.

async function main() {
  const [yearStr, make, model] = process.argv.slice(2);
  if (!yearStr || !make || !model) {
    console.error('Usage: npm run fetch:epa-mpg --workspace @automotive/worker -- <year> "<make>" "<model>"');
    process.exitCode = 1;
    return;
  }
  const vehicles = await fetchEpaVehiclesForModelYear(Number(yearStr), make, model);
  console.log(JSON.stringify(vehicles, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
