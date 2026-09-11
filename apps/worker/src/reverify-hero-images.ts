import { prisma } from "@automotive/database";
import { detectBrand, searchBrandLogo, hashRemoteImage, getOrCreateLicense } from "./fetch-images.js";
import { verifyImageMatch } from "./verify-image.js";

// One-shot CLI entrypoint (`npm run reverify:hero-images --workspace apps/worker`).
//
// Real, live bug found 2026-09-11 (user caught it directly, live on the
// site): the "byd-denza-n8-luxury-suv..." article was published with a
// BYD Sealion 6 photo as its hero image — a real, different model from
// the same brand, not the Denza N8 the article is actually about.
// Traced via the real AIJob log: the exact same candidate photo was
// correctly REJECTED for a differently-worded context ("BYD's new
// Defender-like SUV breaks cover") but wrongly ACCEPTED for a more
// generic one ("BYD's new luxury electric SUV has a range of over
// 1,000 km") — the vision check's own "low" image detail setting and
// looser prompt wording let a same-brand-different-model photo through
// when the context wasn't visually distinctive. verify-image.ts fixed
// going forward (now "high" detail, explicit same-brand-different-model
// rejection rule) — this script re-runs that stricter check against
// every ALREADY-PUBLISHED real (non-AI, non-logo) hero image already on
// the site, since the old, weaker check may have let others through too
// and nothing before this ever re-checked an image after it was first
// accepted.
//
// Deliberately narrower than replace-ai-images.ts: that script targets
// AI_GENERATED images (replace with something real); this one targets
// images that already claim to be a REAL photo (CREATIVE_COMMONS,
// non-EDITORIAL_ONLY — a logo fallback is already honest about not
// being a photo of the specific car, so it doesn't need re-verification
// the same way) and checks whether that claim actually held up under a
// stricter check. A rejected image is removed and replaced with the
// brand-logo fallback (never left silently blank, never guessed at with
// another photo) — the same "never worse than before" posture
// replace-ai-images.ts already established.
const BATCH_SIZE = Number(process.env.REVERIFY_HERO_IMAGES_BATCH_SIZE ?? 30);

async function main() {
  // Real bug found and fixed live 2026-09-11, same tick this script was
  // first run: `rightsStatus: { not: "EDITORIAL_ONLY" }` alone does NOT
  // reliably exclude logo fallbacks — apps/web's own frontend logo
  // detection has carried a second heuristic since 2026-09-11 earlier
  // the same day specifically because "most of these logo fallbacks on
  // production actually have rightsStatus other than EDITORIAL_ONLY
  // (they came through the generic Commons/Openverse photo search
  // matching a '*logo*' file by title, not through attachHeroImage's
  // deliberate brand-logo path)". Missing that same filename check here
  // meant this script tried to vision-verify a Tesla/Ford/BMW/etc. logo
  // as if it were a real photo of the specific vehicle — which a logo
  // can never pass — deleting perfectly good, already-honest logo
  // fallbacks and either replacing them with the same logo again
  // (wasted, but harmless) or, worse, leaving several articles with NO
  // image at all when a fresh brand-logo search also failed. Fixed by
  // excluding any image whose URL contains "logo", matching the
  // frontend's own established heuristic exactly.
  const candidates = await prisma.articleImage.findMany({
    where: {
      role: "HERO",
      image: {
        sourceType: "CREATIVE_COMMONS",
        rightsStatus: { not: "EDITORIAL_ONLY" },
        generatedByAi: false,
        NOT: { originalUrl: { contains: "logo", mode: "insensitive" } },
      },
      article: { status: "PUBLISHED" },
    },
    take: BATCH_SIZE,
    select: {
      id: true,
      articleId: true,
      image: { select: { id: true, originalUrl: true } },
      article: { select: { headline: true, story: { select: { title: true } } } },
    },
    orderBy: { id: "asc" },
  });

  console.log(`Found ${candidates.length} real (non-AI, non-logo) hero image(s) to re-verify (batch size ${BATCH_SIZE}).`);

  let confirmed = 0;
  let replacedWithLogo = 0;
  let removedNoFallback = 0;
  for (const link of candidates) {
    const context = link.article.story?.title ?? link.article.headline;
    const stillMatches = await verifyImageMatch(link.image.originalUrl, context);
    if (stillMatches) {
      confirmed++;
      continue;
    }

    console.log(`✗ re-verification now rejects "${link.article.headline}" — ${link.image.originalUrl}`);
    await prisma.articleImage.delete({ where: { id: link.id } });

    // Real gap found live 2026-09-11, same run this was first tried:
    // "Denza" (a real, detected brand — BYD's premium sub-brand) has no
    // own standalone logo file discoverable via searchBrandLogo's plain
    // "<brand> logo" Commons search, so those articles lost their image
    // entirely with no fallback at all. Falling back to a sub-brand's
    // real parent company is more honest than leaving nothing, since
    // Denza's own branding and ownership are genuinely, publicly BYD's.
    const PARENT_BRAND: Record<string, string> = { Denza: "BYD" };
    const brand = detectBrand(link.article.headline);
    let logoCandidate = brand ? await searchBrandLogo(brand) : null;
    let logoBrandLabel = brand;
    if (!logoCandidate && brand && PARENT_BRAND[brand]) {
      logoCandidate = await searchBrandLogo(PARENT_BRAND[brand]);
      logoBrandLabel = PARENT_BRAND[brand];
    }
    if (!logoCandidate) {
      removedNoFallback++;
      console.log(`  removed, no brand-logo fallback available (brand detected: ${brand ?? "none"})`);
      continue;
    }

    const { sha256 } = await hashRemoteImage(logoCandidate.thumbUrl);
    const existingImage = await prisma.image.findUnique({ where: { sha256 } });
    const imageId = existingImage
      ? existingImage.id
      : (
          await prisma.image.create({
            data: {
              originalUrl: logoCandidate.thumbUrl,
              sourceType: "CREATIVE_COMMONS",
              rightsStatus: "EDITORIAL_ONLY",
              author: logoCandidate.artist,
              attribution: `${logoCandidate.artist} — ${logoCandidate.licenseShortName}, via ${logoCandidate.provider}`,
              licenseId: await getOrCreateLicense(logoCandidate),
              width: logoCandidate.width,
              height: logoCandidate.height,
              mimeType: logoCandidate.mime,
              sha256,
              generatedByAi: false,
            },
          })
        ).id;
    await prisma.articleImage.create({
      data: { articleId: link.articleId, imageId, role: "HERO", position: 0, altText: `${logoBrandLabel} logo` },
    });
    replacedWithLogo++;
    console.log(`  replaced with the real ${logoBrandLabel} brand logo (honest fallback, not a guessed photo)`);
  }

  console.log(`Done: ${confirmed} confirmed still accurate, ${replacedWithLogo} replaced with a brand logo, ${removedNoFallback} removed with no fallback available.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
