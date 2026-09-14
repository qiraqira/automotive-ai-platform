import { prisma } from "@automotive/database";
import { selfHostImage } from "./self-host-image.js";

// One-shot fix (2026-09-14): Tesla Model Y's own catalog HERO image
// (car_model_images row, imageId cmtsv3zvx0093q9z52w62lvae) was still
// hotlinked straight from thumb.wikimedia.org instead of self-hosted —
// the same standing violation already found and only partially fixed on
// the BMW X5 vs GLE article earlier this session. Found again while
// looking for a real, already-vetted Tesla photo to reuse for a news
// article; fixed at the source (this Image row) instead of reusing the
// hotlink a second time.

const IMAGE_ID = "cmtsv3zvx0093q9z52w62lvae";
const SOURCE_URL = "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5c/Tesla_Model_Y_1X7A6211.jpg/1280px-Tesla_Model_Y_1X7A6211.jpg";

async function main() {
  const image = await prisma.image.findUnique({ where: { id: IMAGE_ID } });
  if (!image) throw new Error(`Image ${IMAGE_ID} not found.`);
  if (image.originalUrl.startsWith("/uploads/")) {
    console.log("Already self-hosted — nothing to do.");
    return;
  }

  const hosted = await selfHostImage(SOURCE_URL);
  await prisma.image.update({
    where: { id: IMAGE_ID },
    data: { originalUrl: hosted.localUrl, localStorageUrl: hosted.localUrl, sha256: hosted.sha256, width: hosted.width, height: hosted.height },
  });
  console.log(`Self-hosted: ${image.originalUrl} -> ${hosted.localUrl}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
