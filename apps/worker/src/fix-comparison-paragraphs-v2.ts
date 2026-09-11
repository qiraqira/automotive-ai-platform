import { prisma } from "@automotive/database";

// Second round (2026-09-12), same real limitation as the first
// fix-comparison-paragraphs.ts (see that file's own comment, since
// removed): seed-real-articles.ts's generic sync only updates existing
// TEXT paragraphs 1:1 by position and never adds one. This rewrite
// (user's own direct feedback: "это хуета... нужно отличные статьи" —
// this is crap, we need excellent articles) grew from 7 paragraphs to
// 9, with new content inserted in the middle (a "how they drive"
// section built from real, attributed reviewer quotes, and a
// third-row-practicality paragraph) — another mid-article insertion the
// generic sync can't handle safely.

const ARTICLE_SLUG = "bmw-x5-vs-mercedes-benz-gle";

const NEW_PARAGRAPHS = [
  "The BMW X5 (G05, on sale since 2018) and the Mercedes-Benz GLE (W167, also since 2018) are the two cars each brand's own shoppers cross-compare most: both are mid-size, three-row-capable luxury SUVs built in Germany, updated on almost identical timelines, and aimed at the same buyer trading up from a 5 Series or E-Class wagon into something taller. Neither company treats the other's showroom as an afterthought — this is the actual head-to-head the segment is fought over.",
  "Dimensions are close enough that neither car reads as obviously bigger in person. The X5 is 4,935mm long on a 2,975mm wheelbase; the GLE is 4,924-4,930mm long (depending on trim) on a slightly longer 2,995mm wheelbase. The GLE is also about 30mm taller (1,795-1,797mm vs the X5's 1,765mm), which shows up mainly as a little extra headroom rather than a different footprint on the road.",
  "In the mainstream six-cylinder trims, Mercedes has the clearer power advantage at launch spec: the GLE 450's 3.0L turbo inline-six (M256) makes 362hp, against 335hp from the X5 xDrive40i's own 3.0L turbo six (B58). Both use mild-hybrid assistance on that six-cylinder engine, and both also offer a real plug-in hybrid variant — the X5 xDrive45e (389hp combined, 24 kWh battery, 30 miles EPA electric range) against the GLE 450e (381hp combined, 23.3 kWh battery, but a real 38-48 mile EPA electric range). The GLE 450e's edge here is genuinely counterintuitive: a smaller battery delivering more real-world electric range than the X5's larger one, not a typo — see this site's own hybrid/PHEV/EV guide for how battery size and real efficiency are two different things.",
  "At the performance end, it's not quite an apples-to-apples pairing: BMW's direct answer to the 603hp Mercedes-AMG GLE 63 S (4.0L biturbo V8, M177) is the X5 M, not the M50i covered in this comparison. The M50i (4.4L twin-turbo V8, N63, 523hp) is BMW's one-step-down performance trim — closer in spirit to a Mercedes-AMG GLE 53 than to the full-fat GLE 63 S.",
  "This is where the two cars actually diverge, and it's the part a spec sheet can't show: how they drive. Top Gear's own road test of the X5 found \"loads of grip and overall body control [that] is remarkable for a 2.1-tonner,\" concluding it's \"certainly not a driver's car in the classic sense, but you don't feel short-changed behind the wheel.\" What Car's review of the same generation praised \"precise, well-weighted steering\" that makes it \"enjoyable to guide this sizeable chunk of metal along your favourite country route.\" The GLE draws the opposite kind of praise from the same class of reviewer: Top Gear calls it \"a very balanced SUV. Comfy, quiet, practical, none too sporty and all the better for it,\" while What Car notes all versions are \"engineered for comfort rather than handling ability\" and are \"at [their] best when cruising on the motorway, where it wafts along and easily deals with ruts and bumps.\" Neither verdict is a knock — they're describing two different real priorities, consistently, across two independent outlets.",
  "Interior technology tells a similar story of Mercedes leaning into comfort and presentation. Top Gear's review of the GLE's cabin calls it \"one of the leaps over the previous GLE, resplendent with its massive twin 12.3in screens and general air of solidity,\" with seats it describes as \"supremely comfortable.\" What Car separately rates the X5's own interior highly too — it isn't a weak point — but the specific praise both outlets give the GLE's cabin technology and finish is more effusive than either gives the X5's.",
  "Practicality has one real, decisive difference buried in the spec sheets: only the GLE can be ordered as a genuine 7-seater. The X5 offers an optional third row, but at 34.9 inches of headroom and 29.2 inches of legroom back there, it's tight enough that reviewers routinely describe it as usable for children only, not adults on a real trip — BMW's own answer for adult-capable third-row seating is the larger, separate X7, not the X5. If a real third row for real adults matters to your decision, that alone settles this comparison before anything else does.",
  "Both cars hold the same top result in Euro NCAP's crash testing, but the GLE scores higher across every individual category: the X5 (tested 2018) came away with 89% adult occupant, 86% child occupant, 75% pedestrian and 75% safety assist; the GLE (tested 2019) scored 91%, 90%, 78% and 78% respectively. Five stars either way, but the GLE's margin is real and consistent, not a rounding difference in one category. Both organizations' own real footage of these exact tests is embedded below, alongside each brand's own official reveal video for this generation.",
  "Cargo and towing tell a closer, more mixed story than the crash-test scores do. Behind the second row, the X5 holds a fractional edge (33.9 cubic feet vs the GLE 450's 33.3), but fold the seats and the GLE actually pulls ahead (74.9 cubic feet vs the X5's 72.3) — neither car is simply \"the bigger one\" depending on which real-world scenario you're packing for. Towing runs the other way from what the GLE's extra horsepower might suggest: BMW rates the X5 at up to 7,200 lbs with the factory tow package, while Mercedes rates the GLE 450 at up to 7,700 lbs — a real 500 lb gap in the GLE's favor despite the two engines being closer in output than in outright pulling capacity.",
  "Put it together and this isn't the toss-up the spec sheet alone suggests. If you actually want to drive — real steering feedback, real body control, a car that rewards a country road — independent reviewers land on the X5, consistently and without much hedging. If you want to be driven, want the plusher, more tech-forward cabin, or need a real third row for real passengers rather than an emergency jump seat, the GLE's advantages (comfort-tuned ride, Top Gear's own praise for its cabin, and the one hard practicality gap neither review nor spec sheet can talk around) make it the more defensible pick for that buyer. Both cars are covered in full on their own model pages, including their real specifications, official videos and any relevant recent news — and both cars' own photos, front and interior, sit in the gallery above.",
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
