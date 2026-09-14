import { prisma } from "@automotive/database";
import { selfHostImage } from "./self-host-image.js";

// One-shot fix (2026-09-14), closing out two standing issues on the same
// article the user originally flagged ("BMW X5 vs Mercedes-Benz GLE"
// had 3 X5 photos and only one Mercedes photo, an interior shot with no
// exterior at all"):
//
// 1. All 4 of this article's original images were still hotlinked from
//    thumb.wikimedia.org — never actually self-hosted, despite the
//    project's own standing "always self-host" rule. Self-hosts each
//    Image row in place (same pattern as the Model Y catalog-photo fix
//    earlier this session).
// 2. The GLE exterior photo added afterward sat in the GALLERY role,
//    so the article's hero slot was still X5-only. Promotes it to a
//    second HERO-role image (position 1) so the article page's own
//    side-by-side hero renderer (added 2026-09-14 for new comparisons)
//    picks it up here too, on a retrofit basis.

const ARTICLE_ID = "cmtwtbvq90000w2sxd0vkf9x3"; // bmw-x5-vs-mercedes-benz-gle

const HOTLINKED_IMAGE_IDS = ["cmtwspjje000ntf6mckxohxut", "cmtxf1kbf0007ht1cp1oosznn", "cmtxf1lva000eht1coa70eakz", "cmtxf1re8000rht1c1ln5hv0l"];
const GLE_EXTERIOR_IMAGE_ID = "cmu0cyb76000dmjj0u32qvmuz";

async function main() {
  for (const imageId of HOTLINKED_IMAGE_IDS) {
    const image = await prisma.image.findUnique({ where: { id: imageId } });
    if (!image) {
      console.log(`Image ${imageId} not found — skipped.`);
      continue;
    }
    if (image.originalUrl.startsWith("/uploads/")) {
      console.log(`Image ${imageId} already self-hosted — skipped.`);
      continue;
    }
    const hosted = await selfHostImage(image.originalUrl);
    await prisma.image.update({
      where: { id: imageId },
      data: { originalUrl: hosted.localUrl, localStorageUrl: hosted.localUrl, sha256: hosted.sha256, width: hosted.width, height: hosted.height },
    });
    console.log(`Self-hosted ${imageId}: ${image.originalUrl} -> ${hosted.localUrl}`);
  }

  const gleRow = await prisma.articleImage.findFirst({ where: { articleId: ARTICLE_ID, imageId: GLE_EXTERIOR_IMAGE_ID } });
  if (!gleRow) throw new Error("GLE exterior ArticleImage row not found.");
  if (gleRow.role === "HERO") {
    console.log("GLE exterior image is already HERO — nothing to promote.");
  } else {
    await prisma.articleImage.update({ where: { id: gleRow.id }, data: { role: "HERO", position: 1 } });
    console.log("Promoted GLE exterior image to HERO position 1 — article now has a side-by-side hero.");
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
