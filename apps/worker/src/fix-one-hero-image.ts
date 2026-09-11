import { prisma } from "@automotive/database";
import { attachHeroImage } from "./fetch-images.js";

// One-off, hand-run fix (2026-09-11): upgrade-logo-images.ts's first
// sweep hit verify-image.ts's since-fixed fail-open bug once, letting a
// wrong photo (a generic dealer-lot shot of regular gas Jeep Wagoneers)
// publish for an article specifically about the Wagoneer S / Ram 1500
// REV extended-range EV variants. Deletes that one wrong hero image and
// re-searches with the now-fixed (fail-closed) verification.
const ARTICLE_ID = "cmttak7nc002i7pw6aptwahmb";
const HEADLINE = "Jeep Wagoneer and Ram 1500 extended-range EVs delayed again";

async function main() {
  await prisma.articleImage.deleteMany({ where: { articleId: ARTICLE_ID, role: "HERO" } });
  console.log("Deleted the wrong hero image.");
  const found = await attachHeroImage(ARTICLE_ID, [HEADLINE]);
  console.log(found ? "Attached a new, verified hero image." : "No verified real photo or brand logo found — article now has no hero image.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
