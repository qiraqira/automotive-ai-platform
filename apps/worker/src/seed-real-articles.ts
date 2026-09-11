import { prisma } from "@automotive/database";
import type { ArticleType, ContentPurpose } from "@automotive/database";

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
// working around: ArticleBlockType includes SPEC_TABLE/COMPARISON/
// FACT_TABLE, but apps/web's article page (articles/[locale]/[slug]/
// page.tsx) only ever renders TEXT blocks today — every other block type
// is silently dropped. Rather than write a block type nothing renders,
// every article below is real, sourced prose in sequential TEXT blocks,
// which works with the renderer that actually exists. A structured
// table renderer is real follow-up work, not done here.
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
      "In the mainstream six-cylinder trims, Mercedes has the clearer power advantage at launch spec: the GLE 450's 3.0L turbo inline-six (M256) makes 362hp, against 335hp from the X5 xDrive40i's own 3.0L turbo six (B58). Both use mild-hybrid assistance on that six-cylinder engine, and both offer a plug-in hybrid variant in some markets — figures for those vary by market and model year, so they're not compared spec-for-spec here.",
      "At the performance end, it's not quite an apples-to-apples pairing: BMW's direct answer to the 603hp Mercedes-AMG GLE 63 S (4.0L biturbo V8, M177) is the X5 M, not the M50i covered in this comparison. The M50i (4.4L twin-turbo V8, N63, 523hp) is BMW's one-step-down performance trim — closer in spirit to a Mercedes-AMG GLE 53 than to the full-fat GLE 63 S.",
      "Both cars hold the same top result in Euro NCAP's crash testing, but the GLE scores higher across every individual category: the X5 (tested 2018) came away with 89% adult occupant, 86% child occupant, 75% pedestrian and 75% safety assist; the GLE (tested 2019) scored 91%, 90%, 78% and 78% respectively. Five stars either way, but the GLE's margin is real and consistent, not a rounding difference in one category.",
      "Neither of these is a case for picking one car over the other on paper alone — the GLE's extra six-cylinder power and slightly better crash-test category scores are real, documented advantages, but the X5's own strengths (see its Facts and Generations above) matter just as much for a real buying decision. Both are covered in full on their own model pages, including their real specifications, official videos and any relevant recent news.",
    ],
    citations: [
      { label: "BMW X5 (G05) — Wikipedia", url: "https://en.wikipedia.org/wiki/BMW_X5_(G05)" },
      { label: "Mercedes-Benz GLE-Class — Wikipedia", url: "https://en.wikipedia.org/wiki/Mercedes-Benz_GLE-Class" },
      { label: "BMW X5 — Euro NCAP 2018 assessment", url: "https://www.euroncap.com/assessments/bmw/x5/0743/" },
      { label: "Mercedes-Benz GLE — Euro NCAP 2019 assessment", url: "https://www.euroncap.com/assessments/mercedes-benz/gle/0755/" },
    ],
    carModelSlugs: [
      { brandSlug: "bmw", modelSlug: "x5" },
      { brandSlug: "mercedes-benz", modelSlug: "gle" },
    ],
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
];

async function main() {
  for (const spec of ARTICLES) {
    const existing = await prisma.article.findUnique({ where: { locale_slug: { locale: "en", slug: spec.slug } } });
    if (existing) {
      // Real gap found and fixed the same tick topicSlug was added: this
      // idempotency check correctly avoids duplicating content, but it
      // also skipped syncing a field added to the spec *after* the
      // article already existed — the ANALYSIS article below got a real
      // topicSlug added post-creation, and this branch would have
      // silently left its topicId null forever, exactly the gap this
      // whole feature exists to close. Syncs topicId (only) on an
      // existing row when the spec's now says something different, never
      // touches content that's already real and published.
      if (spec.topicSlug) {
        const topic = await prisma.topic.findUnique({ where: { slug: spec.topicSlug } });
        if (!topic) throw new Error(`Topic "${spec.topicSlug}" not found — check packages/database/src/bootstrap.ts's real topic list.`);
        if (existing.topicId !== topic.id) {
          await prisma.article.update({ where: { id: existing.id }, data: { topicId: topic.id } });
          console.log(`Article "${spec.slug}" already exists (${existing.id}) — synced topicId to "${spec.topicSlug}".`);
          continue;
        }
      }
      console.log(`Article "${spec.slug}" already exists (${existing.id}) — not creating a duplicate.`);
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
        blocks: { create: spec.paragraphs.map((text, position) => ({ type: "TEXT" as const, position, data: { text } })) },
        carModels: { create: carModels.map((cm) => ({ carModelId: cm.id })) },
        citations: { create: spec.citations },
      },
    });

    console.log(`Created ${spec.type} article "${spec.headline}" (/articles/en/${spec.slug}), id ${article.id}`);
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
