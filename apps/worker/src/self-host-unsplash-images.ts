import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@automotive/database";

// Real, user-reported bug (2026-09-11, reproduced twice — once via this
// session's own browser tooling, once via the user's own real Chrome,
// both on /topics/micromobility): Images.unsplash.com's imgix CDN
// intermittently 503s on a real <img> request (content-negotiated
// Accept header asking for avif/webp) even though the same URL returns
// 200 to a plain curl every time — a genuine third-party CDN reliability
// gap, not a code bug in this app. attach-unsplash-photos.ts's whole
// design was hotlinking (deliberately, to avoid needing an API key) —
// this closes that gap the same way apps/worker/src/generate-image.ts's
// OpenAI images already are: download once, serve from this app's own
// `/uploads/<uuid>.jpg` (the same shared volume + Route Handler, see
// that file's own UPLOAD_DIR comment), so a hero image's uptime no
// longer depends on Unsplash's CDN at all after this runs once.
const UPLOAD_DIR = "/repo/uploads";
const COMPRESSED_WIDTH = 1200;
const JPEG_QUALITY = 82;

async function main() {
  const images = await prisma.image.findMany({
    where: { sourceType: "LICENSED_STOCK", originalUrl: { contains: "images.unsplash.com" } },
  });
  console.log(`Found ${images.length} Unsplash-hotlinked image(s) to self-host.`);

  for (const image of images) {
    try {
      const res = await fetch(image.originalUrl);
      if (!res.ok) {
        console.error(`- ${image.id}: fetch failed (${res.status}) for ${image.originalUrl}`);
        continue;
      }
      const rawBytes = Buffer.from(await res.arrayBuffer());
      const resized = sharp(rawBytes).resize({ width: COMPRESSED_WIDTH, withoutEnlargement: true }).jpeg({ quality: JPEG_QUALITY });
      const { data: bytes, info } = await resized.toBuffer({ resolveWithObject: true });
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const filename = `${randomUUID()}.jpg`;
      await mkdir(UPLOAD_DIR, { recursive: true });
      await writeFile(path.join(UPLOAD_DIR, filename), bytes);

      await prisma.image.update({
        where: { id: image.id },
        data: {
          originalUrl: `/uploads/${filename}`,
          localStorageUrl: `/uploads/${filename}`,
          sha256,
          width: info.width,
          height: info.height,
        },
      });
      console.log(`✓ self-hosted ${image.id} -> /uploads/${filename}`);
    } catch (err) {
      console.error(`- ${image.id}: ${err instanceof Error ? err.message : String(err)}`);
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
