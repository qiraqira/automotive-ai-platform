import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// Reusable one-off: attach a real, human-checked GALLERY-role photo to an
// already-published article. publish-manual-article.ts's own
// galleryImages field only runs at initial publish time; this covers
// the same "photos feel thin" gap on articles that already exist (see
// this session's own pass adding real content depth to the 7 shortest
// comparison articles — same principle, this time for photos instead
// of text). Renders interspersed between paragraphs by the article
// page's own GALLERY logic, not a separate strip.
export interface GalleryImageSpec {
  articleSlug: string;
  sourceUrl: string;
  provider: string;
  licenseSlug: string;
  licenseUrl: string;
  attributionRequired: boolean;
  artist: string;
  altText: string;
}

export async function addGalleryImage(spec: GalleryImageSpec): Promise<void> {
  const article = await prisma.article.findFirst({ where: { slug: spec.articleSlug } });
  if (!article) throw new Error(`article ${spec.articleSlug} not found`);

  const existingCount = await prisma.articleImage.count({ where: { articleId: article.id, role: "GALLERY" } });

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
            attribution: `${spec.artist} — ${spec.licenseSlug.toUpperCase()}, via ${spec.provider}`,
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
    data: { articleId: article.id, imageId, role: "GALLERY", position: existingCount + 1, altText: spec.altText },
  });
  console.log(`${spec.articleSlug}: gallery image attached (position ${existingCount + 1}).`);
}

// CLI entrypoint (`npm run gallery:add --workspace @automotive/worker --
// <path-to-spec.json>`), same JSON-file pattern as publish-manual-article.ts.
async function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error("Usage: npm run gallery:add --workspace @automotive/worker -- <path-to-spec.json>");
    process.exitCode = 1;
    return;
  }
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(specPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  const specs: GalleryImageSpec[] = Array.isArray(parsed) ? parsed : [parsed as GalleryImageSpec];
  for (const spec of specs) {
    await addGalleryImage(spec);
  }
}

const isMain = process.argv[1]?.endsWith("add-gallery-image.ts");
if (isMain) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
