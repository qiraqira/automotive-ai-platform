import { readFile } from "node:fs/promises";
import { prisma } from "@automotive/database";
import type { ArticleType, ContentPurpose, ImageSourceType } from "@automotive/database";
import { ENTITY_TYPE } from "@automotive/types";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// One-shot CLI entrypoint (`npm run publish:manual --workspace
// @automotive/worker -- <path-to-spec.json>`). Publishes a fully
// human/session-written article — no OpenAI/Anthropic API call anywhere
// in this file, no automated Writer or Fact-Checker stage. The person (or
// agentic session, acting as the editor, not an unattended pipeline)
// running this has already researched the story, written the prose, and
// picked+eyeballed the hero image themselves; this script's only job is
// to land that work in the DB through the same real invariants
// write-article.ts/seed-real-articles.ts already enforce (hard citation
// lock before PUBLISHED, self-hosted images only — see self-host-image.ts).
//
// Two real shapes, matching this codebase's own existing split:
//  - "news": a real-time story — creates a Story (so it shows up on /news,
//    which queries via Story, not Article — see apps/web/src/app/news/
//    page.tsx's own `getStories({ hasArticle: true })` call) plus an
//    Article attached to it, same as write-article.ts's writeOne().
//  - "evergreen": knowledge-base content (COMPARISON/ANALYSIS/GUIDE/
//    EXPLAINER) with no Story, same shape seed-real-articles.ts already
//    uses for the X5/GLE/Model Y/RAV4/F-150 pieces.

interface CitationSpec {
  label: string;
  url: string;
}

interface HeroImageSpec {
  sourceUrl: string; // a real, already-vetted image URL (I looked at it myself before writing this)
  provider: string; // e.g. "Wikimedia Commons", "Manufacturer press kit"
  sourceType?: ImageSourceType; // defaults to CREATIVE_COMMONS
  licenseSlug: string; // e.g. "cc-by-sa-4.0", "cc0", "pd", "official-press"
  licenseShortName: string;
  licenseUrl: string;
  attributionRequired: boolean;
  artist: string;
  altText: string;
}

interface ManualArticleSpec {
  kind: "news" | "evergreen";
  slug: string;
  type: ArticleType;
  contentPurpose: ContentPurpose;
  headline: string;
  subtitle: string;
  keyTakeaway: string;
  paragraphs: string[];
  citations: CitationSpec[];
  heroImage?: HeroImageSpec;
  // Added 2026-09-13, user's explicit ask for "many good photos" per
  // article — rendered by the article page's existing GALLERY section
  // (already built 2026-09-11 for the X5 vs GLE rebuild; this was simply
  // never wired up to the manual-publish path since every manual
  // article until now shipped with only a hero photo).
  galleryImages?: HeroImageSpec[];
  topicSlug?: string;
  carModelSlugs?: { brandSlug: string; modelSlug: string }[];
  specTable?: { headers: string[]; rows: { label: string; values: string[] }[] };
  relatedArticleSlugs?: string[];
  scores: {
    qualityScore: number;
    originalityScore: number;
    factualScore: number;
    sourceScore: number;
    valueScore: number;
    readabilityScore: number;
  };
  // "news" only
  storyTitle?: string;
  storySummary?: string;
  importanceScore?: number;
}

async function attachHeroImageFromSpec(
  articleId: string,
  spec: HeroImageSpec,
  role: "HERO" | "GALLERY" = "HERO",
  position = 0,
): Promise<void> {
  const hosted = await selfHostImage(spec.sourceUrl);
  const existingImage = await prisma.image.findUnique({ where: { sha256: hosted.sha256 } });

  const candidate: Pick<ImageCandidate, "provider" | "licenseSlug" | "licenseUrl" | "attributionRequired"> = {
    provider: spec.provider,
    licenseSlug: spec.licenseSlug,
    licenseUrl: spec.licenseUrl,
    attributionRequired: spec.attributionRequired,
  };

  const imageId = existingImage
    ? existingImage.id
    : (
        await prisma.image.create({
          data: {
            originalUrl: hosted.localUrl,
            localStorageUrl: hosted.localUrl,
            sourceType: spec.sourceType ?? "CREATIVE_COMMONS",
            rightsStatus: rightsStatusFor(spec.licenseSlug),
            author: spec.artist,
            attribution: `${spec.artist} — ${spec.licenseShortName}, via ${spec.provider}`,
            licenseId: await getOrCreateLicense(candidate as ImageCandidate),
            width: hosted.width,
            height: hosted.height,
            mimeType: "image/jpeg",
            sha256: hosted.sha256,
            generatedByAi: false,
          },
        })
      ).id;

  await prisma.articleImage.create({
    data: { articleId, imageId, role, position, altText: spec.altText },
  });
}

async function publishOne(spec: ManualArticleSpec): Promise<void> {
  if (spec.citations.length === 0) {
    throw new Error(`"${spec.slug}": refusing to publish with zero citations (hard rule — see write-article.ts's own citation lock).`);
  }

  const existing = await prisma.article.findUnique({ where: { locale_slug: { locale: "en", slug: spec.slug } } });
  if (existing) {
    console.log(`Article "${spec.slug}" already exists (${existing.id}) — not creating a duplicate. Delete it first to republish.`);
    return;
  }

  const carModels = await Promise.all(
    (spec.carModelSlugs ?? []).map(async ({ brandSlug, modelSlug }) => {
      const brand = await prisma.brand.findUnique({ where: { slug: brandSlug } });
      const carModel = brand ? await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: modelSlug } } }) : null;
      if (!carModel) throw new Error(`CarModel ${brandSlug}/${modelSlug} not found.`);
      return carModel;
    }),
  );

  const topic = spec.topicSlug ? await prisma.topic.findUnique({ where: { slug: spec.topicSlug } }) : null;
  if (spec.topicSlug && !topic) throw new Error(`Topic "${spec.topicSlug}" not found.`);

  let storyId: string | undefined;
  if (spec.kind === "news") {
    if (!spec.storyTitle) throw new Error(`"${spec.slug}": kind "news" requires storyTitle.`);
    const story = await prisma.story.create({
      data: {
        title: spec.storyTitle,
        summary: spec.storySummary ?? null,
        status: "PUBLISHED",
        importanceScore: spec.importanceScore ?? 50,
        primaryTopicId: topic?.id,
      },
    });
    storyId = story.id;
  }

  const article = await prisma.article.create({
    data: {
      storyId,
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

  if (spec.heroImage) {
    try {
      await attachHeroImageFromSpec(article.id, spec.heroImage, "HERO", 0);
    } catch (err) {
      console.error(`"${spec.slug}": hero image self-host failed — ${err instanceof Error ? err.message : err}`);
    }
  }

  for (const [i, galleryImage] of (spec.galleryImages ?? []).entries()) {
    try {
      await attachHeroImageFromSpec(article.id, galleryImage, "GALLERY", i + 1);
    } catch (err) {
      console.error(`"${spec.slug}": gallery image #${i + 1} self-host failed — ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`Published ${spec.type} article "${spec.headline}" (/articles/en/${spec.slug}), id ${article.id}${storyId ? `, story ${storyId}` : ""}`);
}

async function wireRelatedArticles(specs: ManualArticleSpec[]): Promise<void> {
  for (const spec of specs) {
    if (!spec.relatedArticleSlugs?.length) continue;
    const fromArticle = await prisma.article.findUnique({ where: { locale_slug: { locale: "en", slug: spec.slug } } });
    if (!fromArticle) continue;
    for (const relatedSlug of spec.relatedArticleSlugs) {
      const toArticle = await prisma.article.findUnique({ where: { locale_slug: { locale: "en", slug: relatedSlug } } });
      if (!toArticle) {
        console.log(`  Related-article link "${spec.slug}" -> "${relatedSlug}" skipped: target not found.`);
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

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error("Usage: npm run publish:manual --workspace @automotive/worker -- <path-to-spec.json>");
    process.exitCode = 1;
    return;
  }
  const raw = await readFile(specPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  const specs: ManualArticleSpec[] = Array.isArray(parsed) ? parsed : [parsed as ManualArticleSpec];

  for (const spec of specs) {
    await publishOne(spec);
  }
  await wireRelatedArticles(specs);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
