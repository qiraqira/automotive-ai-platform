import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Shared self-hosting step, extracted from self-host-unsplash-images.ts's
// own inline logic (see that file's comment for the real 503-on-hotlink
// bug this closes) — every image this platform shows must be downloaded
// once and served from this app's own /uploads/<uuid>.jpg, never hotlinked
// from a third-party CDN. fetch-images.ts's attachHeroImage() and the
// manual publish-manual-article.ts importer both call this now, so
// there's exactly one place that writes to UPLOAD_DIR.
const UPLOAD_DIR = "/repo/uploads";
const COMPRESSED_WIDTH = 1200;
const JPEG_QUALITY = 82;
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = "AutomotiveAIPlatform/1.0 (https://autonewsfeed.com; contact via site)";

export interface SelfHostedImage {
  localUrl: string; // "/uploads/<uuid>.jpg" — goes straight into Image.originalUrl/localStorageUrl
  sha256: string;
  width: number;
  height: number;
}

export async function selfHostImage(sourceUrl: string): Promise<SelfHostedImage> {
  const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`fetch failed (${res.status}) for ${sourceUrl}`);
  const rawBytes = Buffer.from(await res.arrayBuffer());
  const resized = sharp(rawBytes).resize({ width: COMPRESSED_WIDTH, withoutEnlargement: true }).jpeg({ quality: JPEG_QUALITY });
  const { data: bytes, info } = await resized.toBuffer({ resolveWithObject: true });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = `${randomUUID()}.jpg`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, filename), bytes);
  return { localUrl: `/uploads/${filename}`, sha256, width: info.width, height: info.height };
}
