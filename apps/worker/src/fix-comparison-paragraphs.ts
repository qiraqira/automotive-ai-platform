import { prisma } from "@automotive/database";

// One-off, hand-run fix (2026-09-11): seed-real-articles.ts's own sync
// logic for an ALREADY-PUBLISHED article deliberately only updates
// existing TEXT paragraphs 1:1 by position — it never adds or removes
// one, since a real length change needs a human editorial decision
// about where it fits (see that file's own comment). The BMW X5 vs GLE
// rebuild inserted a brand-new cargo/towing paragraph in the MIDDLE of
// the existing 5, growing it to 6 — running the generic sync as-is
// would silently drop the new paragraph and, worse, overwrite the
// wrong existing paragraphs by index. This replaces all of that
// article's TEXT blocks with the current spec's paragraphs in order;
// the SPEC_TABLE block and citations are left to the normal
// `npm run seed:real-articles` sync afterward, which already handles
// those correctly.

const ARTICLE_SLUG = "bmw-x5-vs-mercedes-benz-gle";

const NEW_PARAGRAPHS = [
  "The BMW X5 (G05, on sale since 2018) and the Mercedes-Benz GLE (W167, also since 2018) are the two cars each brand's own shoppers cross-compare most: both are mid-size, three-row-capable luxury SUVs built in Germany, updated on almost identical timelines, and aimed at the same buyer trading up from a 5 Series or E-Class wagon into something taller.",
  "Dimensions are close enough that neither car reads as obviously bigger in person. The X5 is 4,935mm long on a 2,975mm wheelbase; the GLE is 4,924-4,930mm long (depending on trim) on a slightly longer 2,995mm wheelbase. The GLE is also about 30mm taller (1,795-1,797mm vs the X5's 1,765mm), which shows up mainly as a little extra headroom rather than a different footprint on the road.",
  "In the mainstream six-cylinder trims, Mercedes has the clearer power advantage at launch spec: the GLE 450's 3.0L turbo inline-six (M256) makes 362hp, against 335hp from the X5 xDrive40i's own 3.0L turbo six (B58). Both use mild-hybrid assistance on that six-cylinder engine, and both also offer a real plug-in hybrid variant — the X5 xDrive45e (389hp combined, 24 kWh battery, 30 miles EPA electric range) against the GLE 450e (381hp combined, 23.3 kWh battery, but a real 38-48 mile EPA electric range). The GLE 450e's edge here is genuinely counterintuitive: a smaller battery delivering more real-world electric range than the X5's larger one, not a typo — see this site's own hybrid/PHEV/EV guide for how battery size and real efficiency are two different things.",
  "At the performance end, it's not quite an apples-to-apples pairing: BMW's direct answer to the 603hp Mercedes-AMG GLE 63 S (4.0L biturbo V8, M177) is the X5 M, not the M50i covered in this comparison. The M50i (4.4L twin-turbo V8, N63, 523hp) is BMW's one-step-down performance trim — closer in spirit to a Mercedes-AMG GLE 53 than to the full-fat GLE 63 S.",
  "Both cars hold the same top result in Euro NCAP's crash testing, but the GLE scores higher across every individual category: the X5 (tested 2018) came away with 89% adult occupant, 86% child occupant, 75% pedestrian and 75% safety assist; the GLE (tested 2019) scored 91%, 90%, 78% and 78% respectively. Five stars either way, but the GLE's margin is real and consistent, not a rounding difference in one category. Both organizations' own real footage of these exact tests is embedded below, alongside each brand's own official reveal video for this generation.",
  "Cargo and towing tell a closer, more mixed story than the crash-test scores do. Behind the second row, the X5 holds a fractional edge (33.9 cubic feet vs the GLE 450's 33.3), but fold the seats and the GLE actually pulls ahead (74.9 cubic feet vs the X5's 72.3) — neither car is simply \"the bigger one\" depending on which real-world scenario you're packing for. Towing runs the other way from what the GLE's extra horsepower might suggest: BMW rates the X5 at up to 7,200 lbs with the factory tow package, while Mercedes rates the GLE 450 at up to 7,700 lbs — a real 500 lb gap in the GLE's favor despite the two engines being closer in output than in outright pulling capacity.",
  "Neither of these is a case for picking one car over the other on paper alone — the GLE's extra six-cylinder power, slightly better crash-test category scores and higher tow rating are real, documented advantages, but the X5's fractionally larger seats-up cargo hold and the strengths covered on its own model page (Facts and Generations above) matter just as much for a real buying decision. Both are covered in full on their own model pages, including their real specifications, official videos and any relevant recent news — and both cars' own photos, front and interior, sit in the gallery above.",
];

async function main() {
  const article = await prisma.article.findUnique({
    where: { locale_slug: { locale: "en", slug: ARTICLE_SLUG } },
    include: { blocks: true },
  });
  if (!article) throw new Error(`Article "${ARTICLE_SLUG}" not found.`);

  const textBlocks = article.blocks.filter((b) => b.type === "TEXT").sort((a, b) => a.position - b.position);
  const otherBlocks = article.blocks.filter((b) => b.type !== "TEXT").sort((a, b) => a.position - b.position);
  const textBasePosition = textBlocks.length > 0 ? Math.min(...textBlocks.map((b) => b.position)) : 0;
  // The new paragraph count can differ from the old one (it grew from 6
  // to 7 here) — every block that came AFTER the old text run (the
  // SPEC_TABLE) needs to shift by that same delta, or it collides with
  // (or leaves a gap before) the new text run's positions.
  const positionDelta = NEW_PARAGRAPHS.length - textBlocks.length;

  await prisma.articleBlock.deleteMany({ where: { id: { in: textBlocks.map((b) => b.id) } } });
  await prisma.articleBlock.createMany({
    data: NEW_PARAGRAPHS.map((text, i) => ({ articleId: article.id, type: "TEXT" as const, position: textBasePosition + i, data: { text } })),
  });
  for (const block of otherBlocks) {
    if (block.position >= textBasePosition && positionDelta !== 0) {
      await prisma.articleBlock.update({ where: { id: block.id }, data: { position: block.position + positionDelta } });
    }
  }

  console.log(
    `Replaced ${textBlocks.length} TEXT block(s) with ${NEW_PARAGRAPHS.length} new one(s), shifted ${otherBlocks.length} other block(s) by ${positionDelta}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
