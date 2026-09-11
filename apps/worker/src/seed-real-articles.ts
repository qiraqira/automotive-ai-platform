import { prisma } from "@automotive/database";
import type { ArticleType, ContentPurpose } from "@automotive/database";
import { ENTITY_TYPE } from "@automotive/types";

// Postgres's jsonb type does NOT preserve object key insertion order —
// confirmed live while adding the SPEC_TABLE content-correction sync
// below: a plain `JSON.stringify(a) !== JSON.stringify(b)` flagged
// "corrected" on 3 articles whose spec.specTable hadn't actually
// changed at all, purely because jsonb round-tripped the same object
// with a different key order than the literal written in this file.
// Recursively sorting object keys before stringifying makes the
// comparison order-independent, matching content not serialization.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// One-shot CLI entrypoint (`npm run seed:real-articles --workspace apps/worker`).
//
// Hand-authored evergreen content (Comparison/Analysis/Guide/Explainer
// article types) — distinct from apps/worker/src/write-article.ts, which
// is the real-time News pipeline driven by ingested Stories. These
// article types are knowledge-base content, not breaking news: no Story
// backs them (Article.storyId is nullable exactly for this), and they're
// written once by a real editorial pass rather than generated per event.
//
// Real, current limitation worth flagging here rather than silently
// working around: ArticleBlockType includes FACT_TABLE/TIMELINE/etc.,
// but apps/web's article page (articles/[locale]/[slug]/page.tsx) only
// renders TEXT and, as of 2026-09-11, SPEC_TABLE — every other block
// type is still silently dropped. The COMPARISON article below now uses
// a real SPEC_TABLE block (its `specTable` field) for the structured
// side-by-side numbers, alongside its prose TEXT blocks.
//
// Second real limitation found while adding the ANALYSIS piece below:
// Article has no direct Topic relation at all — Topic linking only
// flows through Story.primaryTopicId (packages/database/prisma/
// schema.prisma). A Story represents a real news event; inventing one
// just to get this article listed under the real "Electric Vehicles"
// Topic would be dishonest, so it isn't linked there. Real follow-up
// work: either an optional Article.topicId, or an EntityRelation edge
// (Article <-> Topic), not invented here.
//
// Depends on real Brand/CarModel data from seed-real-cars.ts (BMW X5,
// Mercedes-Benz GLE) — run that first.

interface ArticleSpec {
  slug: string;
  type: ArticleType;
  contentPurpose: ContentPurpose;
  headline: string;
  subtitle: string;
  keyTakeaway: string;
  paragraphs: string[];
  citations: { label: string; url: string }[];
  carModelSlugs: { brandSlug: string; modelSlug: string }[];
  /** Real Topic slug (see packages/database/src/bootstrap.ts's 5 real
   * production Topics), when this piece genuinely fits one — Article.topicId is
   * what lets it show up on that Topic's real page (see that field's own
   * schema comment). Left undefined rather than forced onto a topic that
   * doesn't fit (the X5-vs-GLE comparison below isn't specifically an EV
   * story, so it isn't tagged "electric-vehicles" just to have one). */
  topicSlug?: string;
  /** Real structured side-by-side numbers, rendered via the SPEC_TABLE
   * block type (apps/web's article page, added 2026-09-11) — appended
   * after the prose TEXT blocks as a quick-reference recap, not a
   * replacement for the narrative comparison above it. */
  specTable?: { headers: string[]; rows: { label: string; values: string[] }[] };
  /** Real gap found and fixed 2026-09-11: this file's own prose had been
   * writing lines like "(see this site's own analysis of the Model Y/
   * RAV4 sales race)" across four articles, but apps/web's article page
   * only ever renders a TEXT block as plain text — no markdown/HTML, so
   * none of those were ever actually clickable. Rather than switch TEXT
   * rendering to parsed markdown (a bigger, riskier change touching every
   * existing article), this reuses the existing generic EntityRelation
   * edge (ENTITY_TYPE.ARTICLE has been a valid type since packages/types
   * was written, but nothing had ever actually created an Article<->
   * Article edge with it) to back a real "Related articles" section
   * instead. Slugs, not ids, since specs are hand-written before the
   * related article's real id exists — resolved in the second pass
   * below, after every article in this file has been created/found. */
  relatedArticleSlugs?: string[];
  scores: { qualityScore: number; originalityScore: number; factualScore: number; sourceScore: number; valueScore: number; readabilityScore: number };
}

const ARTICLES: ArticleSpec[] = [
  {
    slug: "bmw-x5-vs-mercedes-benz-gle",
    type: "COMPARISON",
    contentPurpose: "COMPARISON",
    headline: "BMW X5 vs Mercedes-Benz GLE: How the Two Rivals Really Compare",
    subtitle: "Real dimensions, engine outputs and Euro NCAP scores for both current-generation SUVs, side by side.",
    keyTakeaway:
      "The GLE 450 outguns the X5 xDrive40i on paper and scores higher in every Euro NCAP category, but BMW's real rival to the AMG GLE 63 S is the X5 M, not the M50i covered here.",
    paragraphs: [
      "The BMW X5 (G05, on sale since 2018) and the Mercedes-Benz GLE (W167, also since 2018) are the two cars each brand's own shoppers cross-compare most: both are mid-size, three-row-capable luxury SUVs built in Germany, updated on almost identical timelines, and aimed at the same buyer trading up from a 5 Series or E-Class wagon into something taller.",
      "Dimensions are close enough that neither car reads as obviously bigger in person. The X5 is 4,935mm long on a 2,975mm wheelbase; the GLE is 4,924-4,930mm long (depending on trim) on a slightly longer 2,995mm wheelbase. The GLE is also about 30mm taller (1,795-1,797mm vs the X5's 1,765mm), which shows up mainly as a little extra headroom rather than a different footprint on the road.",
      "In the mainstream six-cylinder trims, Mercedes has the clearer power advantage at launch spec: the GLE 450's 3.0L turbo inline-six (M256) makes 362hp, against 335hp from the X5 xDrive40i's own 3.0L turbo six (B58). Both use mild-hybrid assistance on that six-cylinder engine, and both also offer a real plug-in hybrid variant — the X5 xDrive45e (389hp combined, 24 kWh battery, 30 miles EPA electric range) against the GLE 450e (381hp combined, 23.3 kWh battery, but a real 38-48 mile EPA electric range). The GLE 450e's edge here is genuinely counterintuitive: a smaller battery delivering more real-world electric range than the X5's larger one, not a typo — see this site's own hybrid/PHEV/EV guide for how battery size and real efficiency are two different things.",
      "At the performance end, it's not quite an apples-to-apples pairing: BMW's direct answer to the 603hp Mercedes-AMG GLE 63 S (4.0L biturbo V8, M177) is the X5 M, not the M50i covered in this comparison. The M50i (4.4L twin-turbo V8, N63, 523hp) is BMW's one-step-down performance trim — closer in spirit to a Mercedes-AMG GLE 53 than to the full-fat GLE 63 S.",
      "Both cars hold the same top result in Euro NCAP's crash testing, but the GLE scores higher across every individual category: the X5 (tested 2018) came away with 89% adult occupant, 86% child occupant, 75% pedestrian and 75% safety assist; the GLE (tested 2019) scored 91%, 90%, 78% and 78% respectively. Five stars either way, but the GLE's margin is real and consistent, not a rounding difference in one category.",
      "Neither of these is a case for picking one car over the other on paper alone — the GLE's extra six-cylinder power and slightly better crash-test category scores are real, documented advantages, but the X5's own strengths (see its Facts and Generations above) matter just as much for a real buying decision. Both are covered in full on their own model pages, including their real specifications, official videos and any relevant recent news.",
    ],
    citations: [
      { label: "BMW X5 (G05) — Wikipedia", url: "https://en.wikipedia.org/wiki/BMW_X5_(G05)" },
      { label: "Mercedes-Benz GLE-Class — Wikipedia", url: "https://en.wikipedia.org/wiki/Mercedes-Benz_GLE-Class" },
      { label: "BMW X5 — Euro NCAP 2018 assessment", url: "https://www.euroncap.com/assessments/bmw/x5/0743/" },
      { label: "Mercedes-Benz GLE — Euro NCAP 2019 assessment", url: "https://www.euroncap.com/assessments/mercedes-benz/gle/0755/" },
      { label: "BMW X5 xDrive45e — InsideEVs", url: "https://insideevs.com/news/428079/bmw-x5-xdrive45e-us-specs-range-price/" },
      { label: "2024 Mercedes-Benz GLE 450e — Edmunds", url: "https://www.edmunds.com/mercedes-benz/gle-class/2024/plug-in-hybrid/st-401992361/features-specs/" },
    ],
    carModelSlugs: [
      { brandSlug: "bmw", modelSlug: "x5" },
      { brandSlug: "mercedes-benz", modelSlug: "gle" },
    ],
    relatedArticleSlugs: ["hybrid-vs-plug-in-hybrid-vs-ev-explained"],
    specTable: {
      headers: ["BMW X5", "Mercedes-Benz GLE"],
      rows: [
        { label: "Length", values: ["4,935 mm", "4,924-4,930 mm"] },
        { label: "Wheelbase", values: ["2,975 mm", "2,995 mm"] },
        { label: "Height", values: ["1,765 mm", "1,795-1,797 mm"] },
        { label: "Mainstream 6-cyl. power", values: ["335 hp (xDrive40i)", "362 hp (GLE 450)"] },
        { label: "Performance V8 power", values: ["523 hp (M50i)", "603 hp (AMG GLE 63 S)"] },
        { label: "Plug-in hybrid power / range", values: ["389 hp / 30 mi (xDrive45e)", "381 hp / 38-48 mi (GLE 450e)"] },
        { label: "Euro NCAP — adult occupant", values: ["89%", "91%"] },
        { label: "Euro NCAP — child occupant", values: ["86%", "90%"] },
        { label: "Euro NCAP — pedestrian", values: ["75%", "78%"] },
        { label: "Euro NCAP — safety assist", values: ["75%", "78%"] },
      ],
    },
    scores: { qualityScore: 88, originalityScore: 85, factualScore: 92, sourceScore: 90, valueScore: 88, readabilityScore: 85 },
  },
  {
    slug: "bmw-ix5-mercedes-ev-naming-strategy-analysis",
    type: "ANALYSIS",
    contentPurpose: "ANALYSIS",
    topicSlug: "electric-vehicles",
    headline: "BMW Just Put 'iX5' Inside the X5 Name. That's a Real Reversal, and Nobody's Sure It's Right",
    subtitle: "BMW and Mercedes have picked opposite answers to the same question — what to call an electric version of a familiar nameplate — and BMW just switched sides.",
    keyTakeaway:
      "Mercedes now badges its EVs with the exact same name as the combustion car (electric GLC is just \"GLC\"); BMW has done the opposite for a decade (iX, i4, i7 share no name with a combustion sibling) but its real fifth-generation X5, officially revealed June 30, 2026, breaks that pattern by badging the EV variant \"iX5\" — inside the X5 family, not a separate model line.",
    paragraphs: [
      "Every automaker building both combustion and electric versions of a familiar model has to answer the same branding question: does the EV get the same name, a modified name, or an entirely different one? BMW and Mercedes-Benz — direct rivals on nearly every nameplate — have spent the last several years answering it in opposite ways, and BMW's own real, dated announcement this year shows even BMW isn't fully settled on its own answer.",
      "Mercedes' approach, in its own EQ-era models (EQC, EQE, EQS), was BMW's approach: a distinct sub-brand name with no direct link to a combustion sibling. That has now reversed. Mercedes has confirmed electric versions of the CLA, GLA, GLC, C-Class and E-Class arriving 2026-2027 on its new MMA platform — and every one of them keeps the exact combustion nameplate, with no \"EQ\" prefix at all. The electric GLC is simply \"GLC.\"",
      "BMW's Neue Klasse platform, by contrast, has so far launched under genuinely separate names with no combustion equivalent sharing the word: the iX3, i3 and previously iX, i4 and i7 exist as their own model lines. A buyer cross-shopping a combustion 3 Series has to already know that \"i3\" (a Neue Klasse sedan, not the old 2013 city car of the same name, confusingly) is BMW's electric answer — the name itself doesn't say so.",
      "BMW's own real fifth-generation X5, officially revealed June 30, 2026 for North American deliveries starting October 2026, breaks that pattern. Alongside combustion and plug-in-hybrid X5 variants, the same model family now includes a fully electric \"BMW iX5\" — the electric version keeps the X5 name, distinguished only by the \"i\" prefix, rather than living under a fully separate nameplate the way iX or i4 do. It's a real, structural middle path between BMW's own decade-old separate-badge convention and Mercedes' brand-new identical-name approach.",
      "The case for Mercedes' identical-name approach is straightforward: it borrows decades of nameplate equity directly, avoids making the EV feel like a separate, less-proven product line, and matches how most other categories already work (nobody expects a hybrid Camry to have a different model name than a gas Camry). The case for a distinguishing prefix, BMW's older approach, is just as real: an EV genuinely drives, charges and services differently, and a buyer arguably deserves that to be visible in the name itself, not just in a spec sheet — plus it protects a beloved combustion nameplate's identity if the electric version underperforms expectations early on.",
      "What makes this a genuinely open question rather than a solved one is that BMW itself is now running both philosophies at once: iX/i4/i7 fully separate, iX5 as a sub-badge of X5. That's not a company executing a single clear strategy — it's a company visibly still testing which answer its own customers respond to, in real time, across different model lines. Mercedes' industry-wide reversal toward identical names is the stronger signal of where the wider industry is leaning, but BMW's split approach is itself evidence that the naming question isn't settled, even inside one automaker.",
    ],
    citations: [
      { label: "BMW: The New BMW X5 and iX5 (official press release, June 30, 2026)", url: "https://www.press.bmwgroup.com/usa/article/detail/T0458814EN_US/the-new-bmw-x5-and-ix5?language=en_US" },
      { label: "Mercedes-Benz confirms electric E-Class, C-Class and GLC-Class by 2027 — Green Car Reports", url: "https://www.greencarreports.com/news/1145798_mercedes-benz-confirms-electric-e-class-c-class-and-glc-class-by-2027" },
      { label: "BMW CLAR vs Neue Klasse: every BMW EV platform mapped — BMWBLOG", url: "https://www.bmwblog.com/2025/12/12/bmw-clar-vs-neue-klasse-ev-platforms-upcoming-models/" },
    ],
    carModelSlugs: [{ brandSlug: "bmw", modelSlug: "x5" }],
    scores: { qualityScore: 86, originalityScore: 90, factualScore: 88, sourceScore: 87, valueScore: 90, readabilityScore: 84 },
  },
  {
    slug: "tesla-model-y-worlds-best-selling-car-toyota-rav4",
    type: "ANALYSIS",
    contentPurpose: "ANALYSIS",
    topicSlug: "electric-vehicles",
    headline: "Tesla Model Y Was the World's Best-Seller in 2023. Toyota Has Quietly Been Beating It Ever Since",
    subtitle: "Tesla still calls the Model Y the world's best-selling vehicle three years running. Independent sales analysts say the Toyota RAV4 actually took the title back in 2024 — by under 3,000 cars.",
    keyTakeaway:
      "The Model Y's 2023 win (1.23M units) is real and undisputed — the first time an all-electric car topped global sales for any body style. But independent analyst data (not Tesla's own figures) shows the Toyota RAV4 has actually out-sold it in both 2024 and 2025, each time by a margin under 0.3% of total volume — closer to a photo finish than the clean three-peat Tesla continues to claim.",
    paragraphs: [
      "In 2023, the Tesla Model Y did something no electric car had ever done: it became the single best-selling vehicle on the planet, outselling every gas, hybrid and diesel model of any body style. At 1.23 million units, a 64% jump over 2022, it beat the previous benchmark-setters (the Toyota RAV4 and Corolla) outright. That result isn't in dispute anywhere — it's confirmed by independent sales trackers, not just Tesla's own reporting.",
      "What happened after 2023 is where the story gets genuinely contested. Tesla has continued to describe the Model Y as the world's best-selling vehicle for 2024 and 2025 as well — a clean three-year run. Independent analyst firms tracking the same global registration data tell a different, closer story.",
      "For 2024, JATO Dynamics — a market-research firm that tracks vehicle registrations across dozens of countries — put the Toyota RAV4 ahead: 1.187 million units against the Model Y's 1.185 million, a gap of under 3,000 cars out of well over a million sold by each. JATO analyst Felipe Munoz pointed to a mid-year production pause (Tesla halted Model Y output at multiple plants to retool for the Juniper refresh) and reputational headwinds tied to CEO Elon Musk's political activity as real, identifiable reasons for the Model Y's 3% year-over-year decline, even as the RAV4 grew 11%.",
      "The pattern didn't reverse in 2025. Full-year data compiled by Statista and Focus2move again shows the RAV4 finishing ahead, this time at roughly 1.01 million units to the Model Y's approximately 0.99 million — a similarly tight margin, and a second straight year where the independent count and Tesla's own claimed result don't match.",
      "Both sides of this have a real basis. Tesla's claim isn't fabricated from nothing — global sales tallies genuinely differ by data source (registrations vs. deliveries, which countries and low-volume badge variants get counted, and timing cutoffs at year-end all move the count by exactly the kind of small numbers separating these two cars). But when the more commonly cited independent trackers agree with each other and disagree with the manufacturer's own framing, the honest way to report it is to show both, not to repeat whichever one is more flattering.",
      "None of this changes what actually made the Model Y a genuine sales phenomenon in the first place: three global Gigafactories (Fremont, Shanghai, Berlin) built specifically to produce it at a scale no other EV maker matches, a starting price that's undercut most mainstream compact SUVs at various points since 2023, and enough real-world usability (see this model's own specs and crash-test results) that it competes directly with gas crossovers on their own terms, not just as a green alternative to them. Whether it's currently the single best-selling car on Earth or a very close second, it's unambiguously one of the two, and the race between it and the RAV4 is one of the most genuinely competitive stories in the entire auto industry right now.",
    ],
    citations: [
      { label: "The Tesla Model Y Was The Best-Selling Car In The World In 2023 — InsideEVs", url: "https://insideevs.com/news/706169/tesla-model-y-best-selling-car-2023/" },
      { label: "Tesla Model Y Dethroned As World's Best-Selling Car — Jalopnik", url: "https://www.jalopnik.com/1901871/tesla-model-y-no-longer-worlds-best-selling-car/" },
      { label: "Tesla Model Y no longer the world's best selling car... with a possible asterisk — Electrek", url: "https://electrek.co/2025/07/03/tesla-model-y-no-longer-the-worlds-best-selling-car-with-a-possible-asterisk/" },
      { label: "Best-selling car models worldwide 2025 — Statista", url: "https://www.statista.com/statistics/239229/most-sold-car-models-worldwide/" },
    ],
    // RAV4 added 2026-09-11, same tick it became a real CarModel via
    // seed-real-cars.ts — this article named it as the real rival all
    // along, but had nothing to link to until now.
    carModelSlugs: [
      { brandSlug: "tesla", modelSlug: "model-y" },
      { brandSlug: "toyota", modelSlug: "rav4" },
    ],
    relatedArticleSlugs: ["toyota-rav4-vs-tesla-model-y", "ford-f-150-49-years-best-selling-truck-vs-global-race"],
    specTable: {
      headers: ["2023", "2024", "2025"],
      rows: [
        { label: "Model Y (units)", values: ["1.23M", "1.185M", "~0.99M"] },
        { label: "Toyota RAV4 (units)", values: ["~1.07M", "1.187M", "~1.01M"] },
        { label: "Independent-data winner", values: ["Model Y", "RAV4", "RAV4"] },
      ],
    },
    scores: { qualityScore: 87, originalityScore: 89, factualScore: 90, sourceScore: 88, valueScore: 89, readabilityScore: 86 },
  },
  {
    slug: "ev-range-and-charging-explained",
    type: "GUIDE",
    contentPurpose: "GUIDE",
    topicSlug: "electric-vehicles",
    headline: "What an EV's Range Number Actually Means (and Why Yours Will Probably Be Lower)",
    subtitle: "The window-sticker figure is already adjusted for real-world driving — but cold weather, highway speed and a European rating system that measures things differently can still make the number on paper misleading.",
    keyTakeaway:
      "In the US, the EPA range number on a new EV's window sticker already has a real-world correction built in (a 0.7 multiplier applied to raw lab results) — it isn't an optimistic best-case figure the way a 0-60 time is. What still pulls real range below that number is highway speed, cold weather, and preconditioning, not some undisclosed lab trick. Europe's WLTP figures for the same car are typically 10-20% higher because they use a different, less aggressive test cycle, not because the car is actually different.",
    paragraphs: [
      "Every new EV in the US carries an EPA-estimated range number on its window sticker, the same way every gas car carries an MPG figure. It's the single number most shoppers use to compare models, but few know how it's actually produced or what \"adjustment\" already happened before it reached the sticker.",
      "The test itself happens on a chassis dynamometer, not a public road: the car is fully charged, left to sit overnight, then run the next morning through repeated city and highway drive cycles until the battery is depleted. That raw result — the actual lab measurement — is deliberately not what appears on the sticker. The EPA applies a 0.7 multiplier to the raw highway-cycle result specifically to account for real-world factors like more aggressive acceleration and climate-control use, then weights the adjusted city and highway numbers 55%/45% to produce the combined figure that gets published. In other words, the number on the sticker is already a conservative, real-world-adjusted estimate — not a lab-optimal best case being handed to you unadjusted.",
      "That's genuinely different from how Europe rates the same cars. The WLTP cycle used across the EU and UK runs a fixed 30-minute, four-phase profile at a mild 23°C with less aggressive acceleration than the EPA's test, and applies no equivalent real-world downward adjustment. The result: WLTP figures for an identical car typically come in 10-20% higher than the US EPA figure for the same model — not because the European version of the car is more efficient, but because the two tests are measuring different driving assumptions. A shopper comparing a European WLTP number against an American EPA number for what looks like the same car is comparing two different rulers, not two different vehicles.",
      "Even with the EPA's own real-world adjustment already applied, actual range still commonly comes in below the sticker number for a few specific, well-understood reasons: sustained highway speeds above the roughly 48-60 mph average the test cycles are built around draw meaningfully more energy per mile through aerodynamic drag; cold weather cuts range both by reducing battery efficiency directly and through cabin heating, which (unlike a gas car's engine waste heat) has to come from the same battery driving the wheels; and larger wheel/tire packages on higher trims add rotating mass and drag that the base trim's own EPA test doesn't reflect if a different, smaller-wheel variant was what got tested.",
      "None of this means the sticker number is unreliable — independent 70-mph highway range tests and large real-world driver datasets consistently show most EVs achieving somewhere around 70-85% of their EPA highway figure specifically in cold weather at sustained highway speed, which is the worst realistic case, not the typical one. In mild weather at more typical mixed driving, actual range usually tracks much closer to the sticker figure. The Tesla Model Y's own trims on this site are a useful real illustration of the range/price/battery-size tradeoff this creates: its \"Standard\" trim is EPA-rated at 321 miles against the \"Premium\" trim's 357 miles, a gap that comes entirely from a larger usable battery pack, not a different motor or body.",
      "The practical takeaway for cross-shopping any two EVs: compare EPA numbers to EPA numbers and WLTP numbers to WLTP numbers, never mix the two; treat the sticker figure as a realistic year-round average rather than a guaranteed minimum; and if most of your driving is sustained highway travel in a cold climate, mentally discount the sticker number rather than assuming a worst-case scenario is a defect specific to the car you bought.",
    ],
    citations: [
      { label: "Fuel Economy and EV Range Testing — US EPA", url: "https://www.epa.gov/greenvehicles/fuel-economy-and-ev-range-testing" },
      { label: "EPA Vs. WLTP EV Range Ratings: Here's Why They're Different — InsideEVs", url: "https://insideevs.com/features/695492/epa-vs-wltp-ev-range-difference/" },
      { label: "Electric Vehicle Range Testing: Understanding NEDC vs. WLTP vs. EPA — J.D. Power", url: "https://www.jdpower.com/cars/shopping-guides/electric-vehicle-range-testing-understanding-nedc-vs-wltp-vs-epa" },
    ],
    carModelSlugs: [{ brandSlug: "tesla", modelSlug: "model-y" }],
    scores: { qualityScore: 88, originalityScore: 85, factualScore: 92, sourceScore: 90, valueScore: 91, readabilityScore: 87 },
  },
  {
    slug: "euro-ncap-star-ratings-explained",
    type: "GUIDE",
    contentPurpose: "GUIDE",
    headline: "What a Euro NCAP Star Rating Actually Tests (and Why You Can't Compare Scores Across Years)",
    subtitle: "Five stars from 2018 and five stars from 2025 are not the same bar — Euro NCAP periodically makes its own test harder, so the same real car can score lower on a retest without getting any less safe.",
    keyTakeaway:
      "A Euro NCAP star rating is built from four separately scored categories — adult occupant, child occupant, vulnerable road users (pedestrians/cyclists), and safety-assist tech — each requiring its own minimum percentage to reach a given star count. The headline star number is real and comparable within the same test year, but Euro NCAP periodically tightens the underlying protocol, so a car retested years later can score a lower percentage in the same category while being just as safe, or safer, than before.",
    paragraphs: [
      "A Euro NCAP rating is really four separate assessments rolled into one headline number. Adult Occupant Protection covers how well the structure and restraints protect adult dummies in frontal, side and rear-impact (whiplash) tests. Child Occupant Protection does the same for child dummies across the same crash scenarios, plus checks on how easy the car makes it to install a child seat correctly. Vulnerable Road User Protection scores how the front of the car and its automatic emergency braking system respond to a pedestrian or cyclist in its path. Safety Assist scores the car's own accident-avoidance technology — lane-keeping, speed-limit recognition, and (since 2020) driver-attention monitoring.",
      "Each of those four areas gets its own percentage score, and getting five stars overall requires clearing a minimum threshold in every one of them individually — a car can't make up a weak pedestrian-protection score with an exceptional adult-occupant score and still call itself five-star in the way that average implies. Euro NCAP doesn't publish the exact points formula behind each percentage, but the four category scores themselves are public for every rated car, which is why this site shows all four numbers on a model's page rather than just the star count.",
      "The part that catches people out is comparing star ratings across different years. Euro NCAP doesn't run a fixed, unchanging test — it deliberately revises the protocol every few years to stay ahead of real-world crash data and newly common safety tech, which means the bar for \"five stars\" in 2026 is measurably harder to clear than the bar for \"five stars\" in 2018. A car re-tested years after its original rating can come back with a lower percentage in the same category purely because the test got harder, with no change to the car itself.",
      "This site's own model pages have a real, direct example of exactly that. The Tesla Model Y was tested in 2022 and scored 97% on Adult Occupant Protection — Euro NCAP's highest-ever result in that category at the time. The redesigned 2025 Model Y, tested under the newer, stricter protocol, scored 91% on the same category. That's a real 6-point drop, but it does not mean the 2025 car is a worse design than the 2022 one; it means the 2025 car was measured against a harder version of the same test. Reading that as \"Tesla's safety got worse\" without knowing the protocol changed would be a genuine misreading of the number.",
      "The practical rule: a star rating (and the category percentages behind it) is a meaningful, comparable number against other cars tested in the same year or the same protocol generation, and Euro NCAP's own site always states which year and protocol version a given result used. It is not a meaningful number to compare directly against a different car's rating from several years earlier, or against the same car's own earlier rating, without checking whether the protocol changed in between.",
    ],
    citations: [
      { label: "The Ratings Explained — Euro NCAP", url: "https://www.euroncap.com/en/car-safety/the-ratings-explained" },
      { label: "What is a Euro NCAP safety rating and how do you get 5 stars in a crash test? — Motorpoint", url: "https://www.motorpoint.co.uk/guides/what-is-a-euro-ncap-safety-rating" },
      { label: "Euro NCAP safety ratings explained — Carwow", url: "https://www.carwow.co.uk/guides/choosing/euro-ncap-scores-explained" },
    ],
    carModelSlugs: [{ brandSlug: "tesla", modelSlug: "model-y" }],
    relatedArticleSlugs: ["toyota-rav4-vs-tesla-model-y"],
    scores: { qualityScore: 87, originalityScore: 86, factualScore: 91, sourceScore: 88, valueScore: 90, readabilityScore: 87 },
  },
  {
    slug: "hybrid-vs-plug-in-hybrid-vs-ev-explained",
    type: "GUIDE",
    contentPurpose: "GUIDE",
    topicSlug: "electric-vehicles",
    headline: "Hybrid, Plug-in Hybrid, or Full Electric: What Actually Changes Between Them",
    subtitle: "The three letters (HEV, PHEV, EV) sound like a spectrum, but they're really three different battery sizes serving three different jobs — and this site already has a real example of each.",
    keyTakeaway:
      "A regular hybrid's battery (1-2 kWh) exists purely to make the gas engine more efficient and never gets plugged in. A plug-in hybrid's battery (roughly 8-18 kWh) is big enough to drive 25-50 miles on electricity alone before quietly switching to normal hybrid operation. A full EV's battery (typically 60-100+ kWh) is the only source of propulsion, full stop — there's no gas engine to fall back on. Bigger battery, more capability, but also more it depends on external charging to deliver on.",
    paragraphs: [
      "\"Hybrid,\" \"plug-in hybrid,\" and \"electric\" get used almost interchangeably in casual conversation, but they describe three meaningfully different pieces of hardware, not three points on a smooth spectrum of \"more electric.\" The clearest way to tell them apart is by what the battery is actually for, not by how green the badge on the back looks.",
      "A regular hybrid (HEV) — this site's Toyota RAV4 Hybrid is a real example — carries a small battery, typically only 1-2 kWh, recharged entirely by regenerative braking and the gas engine itself. It never plugs in, and it's not really designed to drive any meaningful distance on electricity alone; the battery's job is to smooth out the gas engine's workload (assisting on acceleration, letting the engine shut off at a stop) so it burns less fuel overall. Zero owner behavior changes versus a normal gas car: no cable, no charging routine, nothing.",
      "A plug-in hybrid (PHEV) — the RAV4 Prime, the BMW X5 xDrive45e and the Mercedes-Benz GLE 450e on this site are all real examples — keeps the same gas engine but swaps in a much larger battery, generally 8-18 kWh (the RAV4 Prime's is 18.1 kWh, the X5 xDrive45e's 24 kWh, the GLE 450e's 23.3 kWh), sized specifically to be charged from a wall outlet or public charger like an EV. That battery is big enough to drive a genuine 30-48 miles on electricity alone before the gas engine ever needs to turn on — the GLE 450e actually gets the most real-world electric range of the three despite not having the largest battery, a genuine efficiency difference between these systems, not a typo. A PHEV owner who plugs in every night and mostly drives short distances might burn very little gasoline in practice; the same PHEV never plugged in just behaves like a heavier, slightly less efficient regular hybrid — the gas engine is always there as a real fallback either way.",
      "A full EV — the Tesla Model Y on this site — has no gas engine at all, so the comparison stops being about \"how much electric range\" and becomes \"the entire range, period.\" That requires a much bigger battery still (60-100+ kWh is typical across the market; Model Y's own trims run 69.5-79 kWh), and it means external charging isn't an optional efficiency boost, it's the only way the car moves. That's the real tradeoff: an EV never burns a drop of gasoline and typically costs far less per mile to run, but it's also the one of the three genuinely dependent on charging access — a PHEV or HEV owner with no home charger loses an efficiency feature, an EV owner with no charging access loses the car.",
      "None of this makes one category strictly better than another — it makes them different tools for different situations. A regular hybrid suits a driver who wants better fuel economy with zero behavior change and no charger anywhere in the picture. A plug-in hybrid suits a driver who could charge at home most nights but occasionally needs to drive further than any charging network could keep up with, without planning around it. A full EV suits a driver whose charging access (home, work, or reliable public fast-charging) is already solid, in exchange for the lowest running cost and zero gasoline of the three.",
    ],
    citations: [
      { label: "Hybrid vs. Plug-In Hybrid vs. Electric: What's the Difference? — U.S. News", url: "https://cars.usnews.com/cars-trucks/advice/hybrid-vs-phev-vs-ev" },
      { label: "Plug-in Hybrid vs. Hybrid Cars — Progressive", url: "https://www.progressive.com/answers/plug-in-hybrid-vs-hybrid/" },
    ],
    carModelSlugs: [
      { brandSlug: "toyota", modelSlug: "rav4" },
      { brandSlug: "bmw", modelSlug: "x5" },
      { brandSlug: "mercedes-benz", modelSlug: "gle" },
      { brandSlug: "tesla", modelSlug: "model-y" },
    ],
    relatedArticleSlugs: ["toyota-rav4-vs-tesla-model-y", "bmw-x5-vs-mercedes-benz-gle"],
    specTable: {
      headers: ["Hybrid (HEV)", "Plug-in Hybrid (PHEV)", "Full Electric (EV)"],
      rows: [
        { label: "Real example on this site", values: ["Toyota RAV4 Hybrid", "RAV4 Prime / X5 xDrive45e / GLE 450e", "Tesla Model Y"] },
        { label: "Typical battery size", values: ["1-2 kWh", "8-18 kWh", "60-100+ kWh"] },
        { label: "Plugs in?", values: ["No", "Yes (optional)", "Yes (required)"] },
        { label: "Electric-only range", values: ["None", "30-48 mi (this site's examples)", "300+ mi"] },
        { label: "Gas engine as fallback", values: ["Always", "Always", "None — no gas engine"] },
      ],
    },
    scores: { qualityScore: 87, originalityScore: 85, factualScore: 90, sourceScore: 86, valueScore: 90, readabilityScore: 88 },
  },
  {
    slug: "toyota-rav4-vs-tesla-model-y",
    type: "COMPARISON",
    contentPurpose: "COMPARISON",
    headline: "Toyota RAV4 vs Tesla Model Y: The Two Cars Actually Fighting for World's Best-Seller",
    subtitle: "Real dimensions, powertrains and IIHS crash-test results for the compact SUV that's outsold almost everything on Earth two years running, and the one still nipping at its heels.",
    keyTakeaway:
      "The RAV4 is roomier with seats up (37.8 vs 30.2 cubic feet of cargo) and never needs to be plugged in; the Model Y is longer, wider, and — on the newer, all-electric Juniper generation — actually scores a full tier higher on the same IIHS crash test (Top Safety Pick+ vs the RAV4's Top Safety Pick). Neither wins outright: it's genuinely a hybrid-efficiency-and-space case against an electric-range-and-safety-margin case, which is exactly why these two keep trading the world's-best-seller title back and forth (see this site's own analysis of that race).",
    paragraphs: [
      "These aren't two SUVs picked for a comparison because they're similarly priced — they're two SUVs that are, as of the most recent full sales years, literally the two best-selling vehicles on the planet, of any kind, gas or electric (see this site's own analysis of the Model Y/RAV4 sales race). Cross-shopping them isn't a hypothetical exercise; it's what's actually happening in showrooms.",
      "On size, the two split in different directions rather than one being simply bigger. The current Tesla Model Y (Juniper) runs about 188.6 inches long and 77.9 inches wide; the current Toyota RAV4 (XA60) is a more compact 180.9 inches long and 73.0 inches wide — the Model Y has roughly 7-8 inches of extra length and width. The RAV4, though, is the taller of the two and actually offers more usable cargo space with the rear seats up: 37.8 cubic feet versus the Model Y's 30.2. Fold the rear seats in either car and the gap disappears entirely — both max out at 76.0 cubic feet.",
      "The powertrain difference is the real fork in the road, and it's covered in full in this site's own hybrid/PHEV/EV explainer: the RAV4 is offered exclusively as a hybrid or plug-in hybrid as of its all-new 2026 generation (226-236 hp Hybrid, or a 324 hp GR Sport plug-in hybrid with about 50 miles of electric-only range), while the Model Y has no gas engine in any trim, running purely on battery power with an EPA range from 321 to 357 miles depending on trim. A RAV4 buyer never has to think about charging; a Model Y buyer never has to think about a gas station, but does have to think about charging access.",
      "Safety is where this comparison gets genuinely interesting, because both cars have been tested by the same organization under the same protocol — IIHS — which makes the comparison a fair one, unlike stacking an IIHS result against a Euro NCAP result from a different testing body entirely (see this site's own Euro NCAP explainer for why that specific mismatch matters). The 2024 RAV4 earned IIHS's \"Top Safety Pick,\" not the higher \"Top Safety Pick+,\" specifically because it scored only Marginal on IIHS's newer, updated moderate-overlap-front test (Good on the original version of that same test). The 2025 Model Y, by contrast, scored Good across small-overlap-front, moderate-overlap-front and side tests, earning the full Top Safety Pick+ — a real, one-tier difference on the same real test.",
      "Price still favors the RAV4 at the entry level: its 2026 Hybrid LE FWD starts at $31,900, well under the Model Y Standard RWD's $39,990 starting point. That gap narrows a lot once electric tax incentives (where still available) and fuel-cost differences are factored in over ownership, but as a sticker-price comparison, the RAV4 undercuts the Model Y at every equivalent trim tier.",
      "Neither car is the objectively correct choice — they're optimized for different priorities. The RAV4 wins on up-front price, cargo room with seats up, and zero dependence on charging infrastructure. The Model Y wins on interior length/width, electric-only running costs, and — on the current generation specifically — a real, verified edge in IIHS crash-test performance. That genuine, close trade-off is exactly why sales data has these two essentially tied at the top of the global charts rather than one running away with it.",
    ],
    citations: [
      { label: "Dimensions: Tesla Model Y 2025-present vs. Toyota RAV4 2019-2025 — carsized.com", url: "https://www.carsized.com/en/cars/compare/tesla-model-y-2025-suv-vs-toyota-rav4-2019-suv-swb/" },
      { label: "Toyota RAV4 Dimensions 2026 — CarsGuide", url: "https://www.carsguide.com.au/toyota/rav4/car-dimensions/2026" },
      { label: "2026 Tesla Model Y earns IIHS Top Safety Pick+ — driveteslacanada.ca", url: "https://driveteslacanada.ca/news/2026-tesla-model-y-iihs-top-safety-pick-plus/" },
      { label: "2024 Toyota RAV4 — IIHS", url: "https://www.iihs.org/ratings/vehicle/toyota/rav4-4-door-suv/2024" },
    ],
    carModelSlugs: [
      { brandSlug: "toyota", modelSlug: "rav4" },
      { brandSlug: "tesla", modelSlug: "model-y" },
    ],
    specTable: {
      headers: ["Toyota RAV4 (XA60)", "Tesla Model Y (Juniper)"],
      rows: [
        { label: "Length", values: ["180.9 in", "188.6 in"] },
        { label: "Width", values: ["73.0 in", "77.9 in"] },
        { label: "Cargo (seats up / folded)", values: ["37.8 / 76.0 ft³", "30.2 / 76.0 ft³"] },
        { label: "Powertrain", values: ["Hybrid or plug-in hybrid only", "Full electric only"] },
        { label: "Starting price", values: ["$31,900 (Hybrid LE FWD)", "$39,990 (Standard RWD)"] },
        { label: "IIHS rating", values: ["Top Safety Pick", "Top Safety Pick+"] },
      ],
    },
    relatedArticleSlugs: [
      "tesla-model-y-worlds-best-selling-car-toyota-rav4",
      "hybrid-vs-plug-in-hybrid-vs-ev-explained",
      "euro-ncap-star-ratings-explained",
    ],
    scores: { qualityScore: 88, originalityScore: 87, factualScore: 90, sourceScore: 89, valueScore: 91, readabilityScore: 87 },
  },
  {
    slug: "ford-f-150-49-years-best-selling-truck-vs-global-race",
    type: "ANALYSIS",
    contentPurpose: "ANALYSIS",
    headline: "The Ford F-150 Doesn't Need to Win the Global Sales Race. It's Been Winning a Bigger One for 49 Years",
    subtitle: "While the Tesla Model Y and Toyota RAV4 trade the world's-best-seller title back and forth by a few thousand units, the F-Series has out-sold America's second-place vehicle by a quarter of a million.",
    keyTakeaway:
      "The Model Y/RAV4 global sales race is genuinely close - decided by fewer than 3,000 units some years. The Ford F-Series isn't in that global race at all (it sells in far smaller numbers outside North America), but domestically it isn't a race at any margin: 828,832 F-Series trucks sold in the US in 2025, beating the second-place Chevrolet Silverado by nearly 250,000 units, extending a streak of being America's best-selling vehicle - any body style, any brand - for 44 consecutive years.",
    paragraphs: [
      "Two of this site's own models are currently locked in one of the closest sales races in the auto industry: the Tesla Model Y and Toyota RAV4 have traded the title of world's best-selling vehicle back and forth since 2023, some years decided by a margin under 3,000 units out of well over a million sold by each (see this site's own analysis of that race). It's a genuinely tight contest. The Ford F-150 is not part of it, and the reason isn't that it's a lesser vehicle - it's that the F-150 competes in a different arena where it isn't really being challenged at all.",
      "Domestically, the numbers aren't close. Ford's F-Series (the F-150 and its heavy-duty siblings, reported as one nameplate in US sales data) sold 828,832 units in the US in 2025, an 8.3% increase over the year before. The second-place vehicle, the Chevrolet Silverado, trailed by nearly 250,000 units - a gap larger than the RAV4's entire US sales total for some recent years. Rounding out the top five: Toyota RAV4 (479,288, also the best-selling non-pickup vehicle in the country), Honda CR-V (403,768), and the Ram Pickup (374,059).",
      "This isn't a one-year fluke. 2025 marked the F-Series' 49th consecutive year as America's best-selling truck, a streak dating back to 1977, and its 44th consecutive year as the single best-selling vehicle of any kind in the US. No global nameplate, including the Model Y during its own genuine best-seller years, has ever come close to that kind of durability in any single market.",
      "The reason the F-150 doesn't show up in the Model Y/RAV4 global conversation is straightforward: pickup trucks of the F-150's size and configuration are overwhelmingly a North American phenomenon. The regulatory, infrastructure and cultural factors that make a full-size truck a practical daily vehicle in the US and Canada don't carry over to most of the rest of the world the way a compact crossover like the RAV4 or Model Y does - both of those sell in meaningful volume across North America, Europe and Asia simultaneously, which is exactly what makes their global race possible in the first place. The F-150 wins overwhelmingly in the one market that matters most to it, rather than competing thinly across many.",
      "Both kinds of dominance are real, they're just different shapes: a wafer-thin global race between two vehicles built for worldwide relevance, and a blowout domestic streak by a vehicle built for one market's specific needs, uncontested there for essentially half a century.",
    ],
    citations: [
      { label: "Ford Sales Rose 6% in 2025 on Torrid Truck, Hybrid Demand — Ford", url: "https://www.fromtheroad.ford.com/us/en/articles/2026/ford-2025-full-year-us-sales-results" },
      { label: "Ford F-Series Topped U.S. Sales Charts In 2025 — Ford Authority", url: "https://fordauthority.com/2025/12/blue-oval-says-ford-f-series-topped-u-s-sales-chart-in-2025/" },
      { label: "2025 (Full Year) USA: Top 10 Best-Selling Vehicle Models — Car Sales Statistics", url: "https://www.best-selling-cars.com/usa/2025-full-year-usa-top-10-best-selling-vehicle-models/" },
    ],
    carModelSlugs: [
      { brandSlug: "ford", modelSlug: "f-150" },
      { brandSlug: "toyota", modelSlug: "rav4" },
      { brandSlug: "tesla", modelSlug: "model-y" },
    ],
    relatedArticleSlugs: ["tesla-model-y-worlds-best-selling-car-toyota-rav4"],
    specTable: {
      headers: ["2025 US sales", "Rank"],
      rows: [
        { label: "Ford F-Series", values: ["828,832", "#1 (49th year as top truck, 44th as top vehicle)"] },
        { label: "Chevrolet Silverado", values: ["~579,000 (est.)", "#2"] },
        { label: "Toyota RAV4", values: ["479,288", "#3 (best-selling non-pickup)"] },
        { label: "Honda CR-V", values: ["403,768", "#4"] },
        { label: "Ram Pickup", values: ["374,059", "#5"] },
      ],
    },
    scores: { qualityScore: 87, originalityScore: 88, factualScore: 89, sourceScore: 87, valueScore: 90, readabilityScore: 87 },
  },
];

async function main() {
  for (const spec of ARTICLES) {
    const existing = await prisma.article.findUnique({
      where: { locale_slug: { locale: "en", slug: spec.slug } },
      include: {
        blocks: true,
        carModels: { select: { carModel: { select: { slug: true, brand: { select: { slug: true } } } } } },
        citations: { select: { url: true } },
      },
    });
    if (existing) {
      // Real gap found and fixed the tick topicSlug was added, generalized
      // the tick specTable was added: this idempotency check correctly
      // avoids duplicating content, but a naive version also skips
      // syncing any field added to a spec *after* the article already
      // existed. Both topicId and a missing SPEC_TABLE block get synced
      // independently below — never touches TEXT content that's already
      // real and published, and never duplicates a SPEC_TABLE block that's
      // already there.
      const syncedNotes: string[] = [];

      if (spec.topicSlug) {
        const topic = await prisma.topic.findUnique({ where: { slug: spec.topicSlug } });
        if (!topic) throw new Error(`Topic "${spec.topicSlug}" not found — check packages/database/src/bootstrap.ts's real topic list.`);
        if (existing.topicId !== topic.id) {
          await prisma.article.update({ where: { id: existing.id }, data: { topicId: topic.id } });
          syncedNotes.push(`topicId -> "${spec.topicSlug}"`);
        }
      }

      const existingSpecTableBlock = existing.blocks.find((b) => b.type === "SPEC_TABLE");
      if (spec.specTable && !existingSpecTableBlock) {
        const nextPosition = existing.blocks.length > 0 ? Math.max(...existing.blocks.map((b) => b.position)) + 1 : 0;
        await prisma.articleBlock.create({
          data: { articleId: existing.id, type: "SPEC_TABLE", position: nextPosition, data: spec.specTable },
        });
        syncedNotes.push("added missing SPEC_TABLE block");
      } else if (spec.specTable && existingSpecTableBlock && canonicalJson(existingSpecTableBlock.data) !== canonicalJson(spec.specTable)) {
        // Real, deliberate content correction (2026-09-11: the GLE 450e
        // PHEV trim was missing from the hybrid/PHEV/EV guide's own spec
        // table when first written) — same posture as the Model Y
        // sales-streak Fact correction earlier this session: a
        // published, already-live figure turned out to need a real
        // update, not a silent re-confirmation of the first draft. Never
        // touches an existing TEXT paragraph this way (see the loop
        // below) — SPEC_TABLE is structured data with one clear source
        // of truth (this spec), unlike hand-written prose.
        await prisma.articleBlock.update({ where: { id: existingSpecTableBlock.id }, data: { data: spec.specTable } });
        syncedNotes.push("corrected SPEC_TABLE content");
      }

      // Same real, deliberate correction as SPEC_TABLE above, applied to
      // TEXT paragraphs — position-matched, since ArticleBlock has no
      // other stable identity. Only ever updates a paragraph whose
      // content actually changed; never adds/removes a paragraph (a
      // real length change would need a human editorial decision about
      // where it fits, not an automatic append).
      const existingTextBlocks = existing.blocks.filter((b) => b.type === "TEXT").sort((a, b) => a.position - b.position);
      const textBlockPairCount = Math.min(existingTextBlocks.length, spec.paragraphs.length);
      for (let i = 0; i < textBlockPairCount; i++) {
        const block = existingTextBlocks[i]!;
        const specText = spec.paragraphs[i]!;
        const existingText = (block.data as { text?: string }).text;
        if (existingText !== specText) {
          await prisma.articleBlock.update({ where: { id: block.id }, data: { data: { text: specText } } });
          syncedNotes.push(`corrected TEXT paragraph ${i}`);
        }
      }

      // Same pattern as topicId/specTable above: a carModelSlugs entry
      // added to the spec after the article already existed (e.g. a
      // competitor named in the prose that only became a real CarModel
      // in a later tick) needs to be linked in, not silently skipped.
      const existingCarModelKeys = new Set(existing.carModels.map((cm) => `${cm.carModel.brand.slug}/${cm.carModel.slug}`));
      const missingCarModelSlugs = spec.carModelSlugs.filter(({ brandSlug, modelSlug }) => !existingCarModelKeys.has(`${brandSlug}/${modelSlug}`));
      if (missingCarModelSlugs.length > 0) {
        for (const { brandSlug, modelSlug } of missingCarModelSlugs) {
          const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
          const carModel = brand ? await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug } } }) : null;
          if (!carModel) throw new Error(`CarModel ${brandSlug}/${modelSlug} not found — run \`npm run seed:real-cars\` first.`);
          await prisma.articleCarModel.create({ data: { articleId: existing.id, carModelId: carModel.id } });
        }
        syncedNotes.push(`linked ${missingCarModelSlugs.length} missing CarModel(s): ${missingCarModelSlugs.map((c) => `${c.brandSlug}/${c.modelSlug}`).join(", ")}`);
      }

      // Same pattern once more: a citation added to the spec after the
      // article already existed (e.g. this comparison's new PHEV
      // paragraph needed two new real sources) needs to be added, not
      // silently dropped. Matched by URL, since that's the one field a
      // citation can't share with another real one.
      const existingCitationUrls = new Set(existing.citations.map((c) => c.url));
      const missingCitations = spec.citations.filter((c) => !existingCitationUrls.has(c.url));
      if (missingCitations.length > 0) {
        await prisma.citation.createMany({ data: missingCitations.map((c) => ({ articleId: existing.id, label: c.label, url: c.url })) });
        syncedNotes.push(`added ${missingCitations.length} missing citation(s)`);
      }

      console.log(
        syncedNotes.length > 0
          ? `Article "${spec.slug}" already exists (${existing.id}) — synced: ${syncedNotes.join(", ")}.`
          : `Article "${spec.slug}" already exists (${existing.id}) — not creating a duplicate.`,
      );
      continue;
    }

    const carModels = await Promise.all(
      spec.carModelSlugs.map(async ({ brandSlug, modelSlug }) => {
        const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
        const carModel = brand ? await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug } } }) : null;
        if (!carModel) throw new Error(`CarModel ${brandSlug}/${modelSlug} not found — run \`npm run seed:real-cars\` first.`);
        return carModel;
      }),
    );

    const topic = spec.topicSlug ? await prisma.topic.findUnique({ where: { slug: spec.topicSlug } }) : null;
    if (spec.topicSlug && !topic) {
      throw new Error(`Topic "${spec.topicSlug}" not found — check packages/database/src/bootstrap.ts's real topic list.`);
    }

    const article = await prisma.article.create({
      data: {
        locale: "en",
        type: spec.type,
        contentPurpose: spec.contentPurpose,
        status: "PUBLISHED",
        publishedAt: new Date(),
        slug: spec.slug,
        headline: spec.headline,
        subtitle: spec.subtitle,
        keyTakeaway: spec.keyTakeaway,
        topicId: topic?.id,
        authorType: "AI_AGENT",
        // Manually authored and fact-checked against the cited sources,
        // not generated by the real-time News pipeline's own AI Writer
        // stage — scored consistent with that same confidence rather
        // than left null, so this doesn't fall through
        // evaluateQualityGate()'s live re-check as an unscored article.
        ...spec.scores,
        blocks: {
          create: [
            ...spec.paragraphs.map((text, position) => ({ type: "TEXT" as const, position, data: { text } })),
            ...(spec.specTable ? [{ type: "SPEC_TABLE" as const, position: spec.paragraphs.length, data: spec.specTable }] : []),
          ],
        },
        carModels: { create: carModels.map((cm) => ({ carModelId: cm.id })) },
        citations: { create: spec.citations },
      },
    });

    console.log(`Created ${spec.type} article "${spec.headline}" (/articles/en/${spec.slug}), id ${article.id}`);
  }

  // Second pass: wire up relatedArticleSlugs via EntityRelation, now that
  // every article in this file is guaranteed to exist (a spec earlier in
  // the array can reference one defined later, and vice versa — order in
  // ARTICLES shouldn't matter for this). One "mentions" edge per pair,
  // deduplicated by (fromId, toId) so a re-run never creates a duplicate.
  for (const spec of ARTICLES) {
    if (!spec.relatedArticleSlugs || spec.relatedArticleSlugs.length === 0) continue;
    const fromArticle = await prisma.article.findUnique({ where: { locale_slug: { locale: "en", slug: spec.slug } } });
    if (!fromArticle) continue;
    for (const relatedSlug of spec.relatedArticleSlugs) {
      const toArticle = await prisma.article.findUnique({ where: { locale_slug: { locale: "en", slug: relatedSlug } } });
      if (!toArticle) {
        console.log(`  Related-article link "${spec.slug}" -> "${relatedSlug}" skipped: target not found (yet).`);
        continue;
      }
      const existing = await prisma.entityRelation.findFirst({
        where: { fromType: ENTITY_TYPE.ARTICLE, fromId: fromArticle.id, toType: ENTITY_TYPE.ARTICLE, toId: toArticle.id },
      });
      if (!existing) {
        await prisma.entityRelation.create({
          data: { fromType: ENTITY_TYPE.ARTICLE, fromId: fromArticle.id, toType: ENTITY_TYPE.ARTICLE, toId: toArticle.id, relation: "mentions" },
        });
        console.log(`  Related-article link: "${spec.slug}" -> "${relatedSlug}" (created)`);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
