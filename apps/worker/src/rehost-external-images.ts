import { prisma } from "@automotive/database";
import { selfHostImage } from "./self-host-image.js";

// One-shot migration, 2026-09-16 — a site-wide media sweep found 182
// Image rows (out of 1,163) still pointing straight at
// thumb.wikimedia.org instead of this app's own /uploads (root cause:
// seed-real-cars.ts's attachVerifiedCommonsPhoto() and
// seed-real-cars.ts's other direct `originalUrl: candidate.thumbUrl`
// writes predated self-host-image.ts and never got migrated — see this
// same commit's fix to that function). Spot-checking a sample already
// showed Wikimedia's own thumb service returning 429 under routine,
// non-abusive checking, which is a real live-site availability risk
// this platform doesn't control. Downloads each one exactly once
// (selfHostImage already dedupes by the resized file's own sha256) and
// repoints both originalUrl/localStorageUrl at the new local copy —
// the URL a real reader's browser loads never changes host, no article/
// car-page edit needed.
async function main() {
  const external = await prisma.image.findMany({
    where: { originalUrl: { not: { startsWith: "/uploads/" } } },
    select: { id: true, originalUrl: true },
  });
  console.log(`${external.length} externally-hosted images to migrate.`);

  let migrated = 0;
  let mergedIntoExisting = 0;
  let failed = 0;

  for (const img of external) {
    try {
      const hosted = await selfHostImage(img.originalUrl);
      const existing = await prisma.image.findUnique({ where: { sha256: hosted.sha256 } });

      if (existing && existing.id !== img.id) {
        // Same underlying photo already self-hosted under a different
        // Image row (two models/articles independently picked the same
        // Commons file before this migration existed) — repoint every
        // reference at the surviving row instead of creating a duplicate,
        // then drop the now-orphaned one.
        await prisma.$transaction([
          prisma.articleImage.updateMany({ where: { imageId: img.id }, data: { imageId: existing.id } }),
          prisma.carModelImage.updateMany({ where: { imageId: img.id }, data: { imageId: existing.id } }),
          prisma.image.delete({ where: { id: img.id } }),
        ]);
        mergedIntoExisting++;
        console.log(`  merged ${img.id} -> ${existing.id}`);
      } else {
        await prisma.image.update({
          where: { id: img.id },
          data: { originalUrl: hosted.localUrl, localStorageUrl: hosted.localUrl, sha256: hosted.sha256, width: hosted.width, height: hosted.height, mimeType: "image/jpeg" },
        });
        migrated++;
      }
    } catch (err) {
      failed++;
      console.error(`  FAILED ${img.id} (${img.originalUrl}): ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. migrated=${migrated} merged=${mergedIntoExisting} failed=${failed}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
