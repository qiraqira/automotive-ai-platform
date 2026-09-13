import { prisma } from "@automotive/database";
import type { ArticleImageRole } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "../fetch-images.js";
import { selfHostImage } from "../self-host-image.js";

// Shared helper, extracted 2026-09-13 from the near-identical
// attachXPhoto() function duplicated across seed-corolla.ts/
// seed-civic.ts/seed-crv.ts/seed-model3.ts — every one of those had its
// own copy of "self-host, dedupe by sha256, create Image, create
// CarModelImage" with only the URL/license/artist/alt text actually
// differing. Also the first real HERO+GALLERY caller for CarModel pages
// (see apps/web's car model page, which only ever rendered HERO until
// this same pass added GALLERY rendering there) — every photo here was
// looked at directly by the session attaching it, same "a person
// actually saw it" standard as publish-manual-article.ts's heroImage.

export interface CarPhotoSpec {
  sourceUrl: string;
  provider: string; // e.g. "Wikimedia Commons"
  licenseSlug: string; // e.g. "cc0", "cc-by-4.0", "cc-by-sa-4.0"
  licenseUrl: string;
  attributionRequired: boolean;
  artist: string;
  altText: string;
}

export async function attachCarModelPhoto(
  carModelId: string,
  spec: CarPhotoSpec,
  role: ArticleImageRole,
  position = 0,
  generationId?: string,
): Promise<void> {
  const existing = await prisma.carModelImage.findFirst({ where: { carModelId, role, position } });
  if (existing) {
    console.log(`  Photo (${role}#${position}): already present, left untouched.`);
    return;
  }

  const hosted = await selfHostImage(spec.sourceUrl);
  const existingImage = await prisma.image.findUnique({ where: { sha256: hosted.sha256 } });

  const candidate: Pick<ImageCandidate, "provider" | "licenseSlug" | "licenseUrl" | "attributionRequired"> = {
    provider: spec.provider,
    licenseSlug: spec.licenseSlug,
    licenseUrl: spec.licenseUrl,
    attributionRequired: spec.attributionRequired,
  };

  const licenseShortName = spec.licenseSlug.toUpperCase();
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
            attribution: `${spec.artist} — ${licenseShortName}, via ${spec.provider}`,
            licenseId: await getOrCreateLicense(candidate as ImageCandidate),
            width: hosted.width,
            height: hosted.height,
            mimeType: "image/jpeg",
            sha256: hosted.sha256,
            generatedByAi: false,
          },
        })
      ).id;

  await prisma.carModelImage.create({ data: { carModelId, imageId, role, position, altText: spec.altText, generationId } });
  console.log(`  Photo (${role}#${position}): attached (human-verified, not AI-verified — no OpenAI call).`);
}
