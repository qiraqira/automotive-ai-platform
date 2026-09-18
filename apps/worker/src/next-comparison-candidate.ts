import { prisma } from "@automotive/database";

// Added 2026-09-16, user's own explicit design constraint: comparison
// articles (bmw-x5-vs-mercedes-benz-gle, tesla-model-3-vs-toyota-corolla,
// ...) have all been hand-written so far — publish-manual-article.ts's
// own header says it plainly ("no OpenAI/Anthropic API call anywhere in
// this file"). The user's ask wasn't "wire up a paid AI call from the
// worker" (that's a real ongoing API cost this script deliberately
// avoids — "без api") — it's "occasionally have a session actually write
// one" (the same real-editor pattern every existing comparison article
// already followed), with the EXPENSIVE part (finding a real, uncovered,
// sensible pair and assembling its real spec data) done here,
// deterministically, at zero AI cost, so a session only has to do the
// cheap part: turn already-assembled real numbers into prose.
//
// `npm run compare:next-candidate --workspace @automotive/worker` — no
// args. Prints either a real candidate pair's full spec bundle (JSON) to
// stdout, or "NO_CANDIDATE" if every curated pair below either already
// has a real COMPARISON article or isn't fully catalog-reviewed yet.

// Curated, not exhaustive — real, well-known cross-shopped pairs (same
// segment, a buyer would actually put these two in the same
// spreadsheet), not an attempt to enumerate all 222×221 combinations.
// Matches the editorial-quality-bar standing preference: depth over
// volume, no shallow filler pair. Extend this list by hand as new real
// rivalries come to mind — never auto-generate it from "any two SUVs".
const CANDIDATE_PAIRS: [[string, string], [string, string]][] = [
  [["honda", "civic"], ["mazda", "mazda3"]],
  [["hyundai", "elantra"], ["honda", "civic"]],
  [["toyota", "camry"], ["honda", "accord"]],
  [["honda", "accord"], ["hyundai", "sonata"]],
  [["honda", "cr-v"], ["mazda", "cx-5"]],
  [["subaru", "forester"], ["toyota", "rav4"]],
  [["hyundai", "tucson"], ["honda", "cr-v"]],
  [["toyota", "highlander"], ["honda", "pilot"]],
  [["ford", "explorer"], ["toyota", "highlander"]],
  [["ford", "f-150"], ["chevrolet", "silverado"]],
  [["ford", "f-150"], ["ram", "1500"]],
  [["chevrolet", "silverado"], ["ram", "1500"]],
  [["subaru", "brz"], ["toyota", "gr86"]],
  [["porsche", "911"], ["chevrolet", "corvette"]],
  [["tesla", "model-y"], ["volkswagen", "id-4"]],
  [["hyundai", "ioniq-5"], ["kia", "ev6"]],
  [["honda", "odyssey"], ["toyota", "sienna"]],
  [["chrysler", "pacifica"], ["honda", "odyssey"]],
  [["bmw", "3-series"], ["mercedes-benz", "c-class"]],
  // Audi discontinued the A4 after MY2025 and folded it into a redesigned,
  // renamed A5 (odd numbers = combustion/mild-hybrid under Audi's new
  // scheme) — verified live 2026-09-18 while researching this exact pair,
  // see bmw-3-series-vs-audi-a5-compared. Pointing this entry at the real
  // current car so it doesn't keep resurfacing a nameplate nobody can buy.
  [["audi", "a5"], ["bmw", "3-series"]],
  [["lexus", "rx"], ["acura", "mdx"]],
  [["audi", "q5"], ["bmw", "x3"]],
  [["toyota", "tacoma"], ["chevrolet", "colorado"]],
  [["ford", "ranger"], ["toyota", "tacoma"]],
  // Added 2026-09-18 (session's second candidate-list refill, after the
  // first curated batch above was fully worked through) — same bar:
  // real, well-known cross-shopped pairs, not an exhaustive enumeration.
  [["nissan", "rogue"], ["toyota", "rav4"]],
  [["nissan", "altima"], ["toyota", "camry"]],
  [["volkswagen", "atlas"], ["toyota", "highlander"]],
  [["volkswagen", "tiguan"], ["honda", "cr-v"]],
  [["rivian", "r1t"], ["tesla", "cybertruck"]],
  [["lucid", "air"], ["tesla", "model-s"]],
  [["polestar", "polestar-2"], ["tesla", "model-3"]],
  [["toyota", "tundra"], ["ford", "f-150"]],
  // Added 2026-09-19 (session's third candidate-list refill) — same bar
  // as before, but drawing on this session's Chinese-brand catalog
  // expansion: real, well-known China-vs-West EV rivalries that outlets
  // actually compare (not an attempt to force every Chinese model into
  // some pairing), now that both sides of each pair are catalogReviewed.
  [["byd", "seal"], ["tesla", "model-3"]],
  [["byd", "atto-3"], ["volkswagen", "id-4"]],
  [["xpeng", "p7"], ["polestar", "polestar-2"]],
  [["zeekr", "001"], ["tesla", "model-s"]],
  [["byd", "han"], ["bmw", "3-series"]],
  [["nio", "et5"], ["audi", "a5"]],
];

async function fetchCandidateCar(brandSlug: string, modelSlug: string) {
  const carModel = await prisma.carModel.findFirst({
    where: { slug: modelSlug, brand: { slug: brandSlug }, catalogReviewedAt: { not: null } },
    select: {
      id: true,
      slug: true,
      name: true,
      brand: { select: { slug: true, name: true } },
      // Full license metadata, not just the URL — this candidate's hero
      // photo is meant to be REUSED as-is for the article's own
      // heroImagePair (same already-self-hosted, already-rights-cleared
      // photo the car page shows), which needs the same license fields
      // publish-manual-article.ts's own HeroImageSpec requires.
      images: {
        where: { role: "HERO" },
        select: {
          image: {
            select: {
              originalUrl: true,
              width: true,
              height: true,
              author: true,
              attribution: true,
              license: { select: { provider: true, licenseType: true, licenseUrl: true, attributionRequired: true } },
            },
          },
        },
        take: 1,
      },
      facts: { select: { attribute: true, value: true, unit: true }, orderBy: { validFrom: "desc" }, take: 8 },
      generations: {
        include: { trims: { orderBy: { id: "asc" }, take: 8, include: { engines: { orderBy: { id: "asc" }, take: 1 } } } },
      },
    },
  });
  if (!carModel) return null;
  const openGenerations = carModel.generations.filter((g) => g.endYear == null);
  const generation =
    (openGenerations.length > 0 ? openGenerations : carModel.generations).slice().sort((a, b) => (b.startYear ?? -1) - (a.startYear ?? -1))[0] ?? null;
  return {
    carModelId: carModel.id,
    brandSlug: carModel.brand.slug,
    brandName: carModel.brand.name,
    modelSlug: carModel.slug,
    modelName: carModel.name,
    heroImage: carModel.images[0]
      ? {
          sourceUrl: carModel.images[0].image.originalUrl,
          width: carModel.images[0].image.width,
          height: carModel.images[0].image.height,
          artist: carModel.images[0].image.author ?? "Unknown",
          attribution: carModel.images[0].image.attribution,
          provider: carModel.images[0].image.license?.provider ?? "Unknown",
          licenseSlug: carModel.images[0].image.license?.licenseType ?? "unknown",
          licenseUrl: carModel.images[0].image.license?.licenseUrl ?? "",
          attributionRequired: carModel.images[0].image.license?.attributionRequired ?? true,
        }
      : null,
    generation: generation
      ? {
          name: generation.name,
          startYear: generation.startYear,
          endYear: generation.endYear,
          trims: generation.trims.map((t) => ({ name: t.name, engineName: t.engines[0]?.name ?? null, fuel: t.engines[0]?.fuel ?? null })),
        }
      : null,
    facts: carModel.facts,
  };
}

async function main() {
  // Every pair (order-independent) any real COMPARISON article already
  // covers — same "don't publish the same comparison twice" invariant a
  // human editor would apply by hand.
  const existingLinks = await prisma.article.findMany({
    where: { type: "COMPARISON" },
    select: { carModels: { select: { carModelId: true } } },
  });
  const coveredPairKeys = new Set(existingLinks.map((a) => a.carModels.map((cm) => cm.carModelId).sort().join("|")));

  for (const [[aBrand, aModel], [bBrand, bModel]] of CANDIDATE_PAIRS) {
    const [a, b] = await Promise.all([fetchCandidateCar(aBrand, aModel), fetchCandidateCar(bBrand, bModel)]);
    if (!a || !b) continue; // one side isn't catalogReviewedAt yet — skip, don't force it
    const key = [a.carModelId, b.carModelId].sort().join("|");
    if (coveredPairKeys.has(key)) continue;
    console.log(JSON.stringify({ candidate: [a, b] }, null, 2));
    return;
  }
  console.log("NO_CANDIDATE");
}

main().finally(() => prisma.$disconnect());
