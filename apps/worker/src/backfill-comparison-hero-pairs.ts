import { prisma } from "@automotive/database";
import { selfHostImage } from "./self-host-image.js";

// One-shot retrofit (2026-09-14): the side-by-side hero (added this same
// date for new comparison articles — see publish-manual-article.ts's
// heroImagePair and the article page's own renderer) never got applied
// to the 9 comparison articles published before it existed. This
// promotes the right already-attached GALLERY image to a second
// HERO-role image (position 1) for each one, and self-hosts 2 images
// that were still hotlinked in the process (RAV4's own catalog photo,
// shared by 2 of these articles; the gas F-150's own catalog photo).
//
// Two of these nine had a real, worse gap than "lopsided": the F-150 vs
// F-150 Lightning piece had zero photo of the gas truck, and the RAV4
// vs Model Y piece had zero photo of the Model Y at all — both fixed by
// reusing an already-self-hosted CarModel photo rather than sourcing a
// new one from scratch.

async function promoteGalleryToHero(articleId: string, imageId: string, label: string): Promise<void> {
  const row = await prisma.articleImage.findFirst({ where: { articleId, imageId } });
  if (!row) {
    console.log(`${label}: ArticleImage row not found — skipped.`);
    return;
  }
  if (row.role === "HERO") {
    console.log(`${label}: already HERO — skipped.`);
    return;
  }
  await prisma.articleImage.update({ where: { id: row.id }, data: { role: "HERO", position: 1 } });
  console.log(`${label}: promoted to HERO position 1.`);
}

async function attachHeroFromExistingImage(articleId: string, imageId: string, altText: string, label: string): Promise<void> {
  const existing = await prisma.articleImage.findFirst({ where: { articleId, imageId } });
  if (existing) {
    console.log(`${label}: already attached — skipped.`);
    return;
  }
  await prisma.articleImage.create({ data: { articleId, imageId, role: "HERO", position: 1, altText } });
  console.log(`${label}: attached as new HERO position 1.`);
}

async function selfHostInPlace(imageId: string, label: string): Promise<void> {
  const image = await prisma.image.findUnique({ where: { id: imageId } });
  if (!image) {
    console.log(`${label}: Image ${imageId} not found — skipped.`);
    return;
  }
  if (image.originalUrl.startsWith("/uploads/")) {
    console.log(`${label}: already self-hosted — skipped.`);
    return;
  }
  const hosted = await selfHostImage(image.originalUrl);
  await prisma.image.update({
    where: { id: imageId },
    data: { originalUrl: hosted.localUrl, localStorageUrl: hosted.localUrl, sha256: hosted.sha256, width: hosted.width, height: hosted.height },
  });
  console.log(`${label}: self-hosted ${image.originalUrl} -> ${hosted.localUrl}`);
}

async function main() {
  // Shared hotlinked catalog photos, self-hosted once each.
  await selfHostInPlace("cmtwxika1002aea3a4358cmsm", "Toyota RAV4 catalog photo (shared by 2 articles)");
  await selfHostInPlace("cmtx1vyqn002rqgt0t8w14vka", "Ford F-150 (gas) catalog photo");

  const jobs: { articleId: string; imageId: string; altText?: string; label: string }[] = [
    // Real gap: zero gas-F150 photo at all — reusing the catalog's own.
    { articleId: "cmu046xtt0001tapoypqsb5mb", imageId: "cmtx1vyqn002rqgt0t8w14vka", altText: "Ford F-150", label: "F-150 vs F-150 Lightning: gas F-150" },
    { articleId: "cmu0ce0wt0000km4w4whqiqdy", imageId: "cmu0budt6000qvuu1nm02m1yt", label: "Mustang vs Camaro: Camaro rear" },
    { articleId: "cmu0gu2940000qks0138kxdqm", imageId: "cmu0clcae000wgoqnkawcd77n", label: "Mustang vs Charger Daytona: Daytona front" },
    { articleId: "cmu09g54v0000qbdkuzutwywd", imageId: "cmtsv3zvx0093q9z52w62lvae", label: "Model 3 vs Model Y: Model Y" },
    { articleId: "cmu0h5lk80000ogkqm0qwdi2f", imageId: "cmu04qz730012g2c9w37kxe0t", label: "Model 3 vs Corolla: Corolla" },
    { articleId: "cmu064ddy0000hfngt94bk5n0", imageId: "cmu04xhuc000y3hby9i09pf0t", label: "Corolla vs Civic: Civic" },
    { articleId: "cmu07f3fc0000e46iwuftm1ec", imageId: "cmu06eijc000wvi6r1p3ep9w8", label: "RAV4 vs CR-V: CR-V" },
    // Real gap: zero Model Y photo at all — reusing the now-self-hosted catalog photo.
    { articleId: "cmtwz73bt0000xmg4yi4mnu9i", imageId: "cmtsv3zvx0093q9z52w62lvae", altText: "Tesla Model Y", label: "RAV4 vs Model Y: Model Y" },
  ];

  for (const job of jobs) {
    if (job.altText) {
      await attachHeroFromExistingImage(job.articleId, job.imageId, job.altText, job.label);
    } else {
      await promoteGalleryToHero(job.articleId, job.imageId, job.label);
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
