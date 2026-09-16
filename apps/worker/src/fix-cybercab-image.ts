import { prisma } from "@automotive/database";
import { getOrCreateLicense, rightsStatusFor, type ImageCandidate } from "./fetch-images.js";
import { selfHostImage } from "./self-host-image.js";

// Third mismatch found the same session (2026-09-16), caught manually
// while double-checking media-health-check.ts's output: the "Tesla
// Reveals Modular Cybercab Assembly" article's hero image was a group
// of scuba divers underwater — the altText ("Here's our crew!
// (4581143291)") didn't trip the word-overlap heuristic because
// "Cybercab"/"Tesla" don't appear in that altText at all, so there was
// no false *or* true overlap to flag; only a direct look at the image
// caught it. Replaced with a real, human-checked Commons photo of the
// actual Cybercab.
async function main() {
  const article = await prisma.article.findFirst({ where: { slug: "tesla-reveals-modular-cybercab-assembly-using-parallel-production-lines" } });
  if (!article) {
    const byHeadline = await prisma.article.findFirst({ where: { headline: "Tesla Reveals Modular Cybercab Assembly Using Parallel Production Lines" } });
    if (!byHeadline) throw new Error("article not found");
    await fix(byHeadline.id);
    return;
  }
  await fix(article.id);
}

async function fix(articleId: string) {
  const heroLink = await prisma.articleImage.findFirst({ where: { articleId, role: "HERO" } });
  if (!heroLink) throw new Error("no HERO image");

  const hosted = await selfHostImage("https://commons.wikimedia.org/wiki/Special:FilePath/Tesla%20Cybercab%20at%20Santana%20Row%20oblique%20view%20dllu.jpg");
  const existingImage = await prisma.image.findUnique({ where: { sha256: hosted.sha256 } });
  const candidate: Pick<ImageCandidate, "provider" | "licenseSlug" | "licenseUrl" | "attributionRequired"> = {
    provider: "Wikimedia Commons",
    licenseSlug: "cc-by-sa-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    attributionRequired: true,
  };
  const imageId = existingImage
    ? existingImage.id
    : (
        await prisma.image.create({
          data: {
            originalUrl: hosted.localUrl,
            localStorageUrl: hosted.localUrl,
            sourceType: "CREATIVE_COMMONS",
            rightsStatus: rightsStatusFor("cc-by-sa-4.0"),
            author: "Dllu",
            attribution: "Dllu — CC-BY-SA-4.0, via Wikimedia Commons",
            licenseId: await getOrCreateLicense(candidate as ImageCandidate),
            width: hosted.width,
            height: hosted.height,
            mimeType: "image/jpeg",
            sha256: hosted.sha256,
            generatedByAi: false,
          },
        })
      ).id;

  await prisma.articleImage.update({ where: { id: heroLink.id }, data: { imageId, altText: "Tesla Cybercab on display" } });
  console.log("Cybercab article: hero image replaced.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
