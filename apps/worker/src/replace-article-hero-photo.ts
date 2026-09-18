import { readFile } from "node:fs/promises";
import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// One-shot CLI (`npm run replace:article-hero --workspace @automotive/worker
// -- <path-to-spec.json>`). Swaps a PUBLISHED article's HERO photo for a
// real one — built for the exact gap media-health-check.ts's "suspicious
// article images" pass finds: an old ingestion path self-hosted a plain
// brand/wordmark LOGO as an article's HERO image (e.g. "Volkswagen logo",
// "Dodge logo") instead of a real photo, which technically isn't "zero
// photos" (media-health-check's other check) but is barely better —
// same "an article needs a real photo of the actual thing, not a
// placeholder" standard as every other image rule this project follows.
// Never touches the old Image row itself (a shared logo asset may be
// reused by other articles) — only repoints this one article's HERO
// ArticleImage at a newly self-hosted, human-verified real photo.
interface ReplaceSpec {
  slug: string;
  sourceUrl: string;
  provider: string;
  licenseSlug: string;
  licenseShortName: string;
  licenseUrl: string;
  attributionRequired: boolean;
  artist: string;
  altText: string;
}

async function replaceOne(spec: ReplaceSpec): Promise<void> {
  const article = await prisma.article.findFirst({ where: { slug: spec.slug } });
  if (!article) {
    console.log(`[skip] "${spec.slug}" — article not found`);
    return;
  }
  const oldHero = await prisma.articleImage.findFirst({ where: { articleId: article.id, role: "HERO" } });

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
            sourceType: "CREATIVE_COMMONS",
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

  if (oldHero) {
    await prisma.articleImage.delete({ where: { id: oldHero.id } });
  }
  await prisma.articleImage.create({ data: { articleId: article.id, imageId, role: "HERO", position: 0, altText: spec.altText } });
  console.log(`[ok] "${spec.slug}" — hero photo replaced${oldHero ? " (old logo image row left in place, may be reused elsewhere)" : ""}`);
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error("Usage: npm run replace:article-hero --workspace @automotive/worker -- <path-to-spec.json>");
    process.exitCode = 1;
    return;
  }
  const raw = await readFile(specPath, "utf-8");
  const specs: ReplaceSpec[] = JSON.parse(raw);
  for (const spec of specs) await replaceOne(spec);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
