import { prisma } from "@automotive/database";
import { hashRemoteImage } from "./fetch-images.js";

// One-shot CLI entrypoint, NOT wired into any automatic pipeline —
// deliberately hand-curated, one run at a time.
//
// Real user request (2026-09-11): use Unsplash for generic/lifestyle/
// industry content that has no single specific vehicle to depict (e-bike
// lifestyle shots, solar panels, generic EV charging) — never for an
// article naming one specific real vehicle model, which still requires
// a real, vision-verified Commons/Openverse photo of that exact car
// (fetch-images.ts's attachHeroImage()) or an honest brand-logo
// fallback, never a generic stock substitute.
//
// No Unsplash API key needed: confirmed live on the user's own
// belarosa.ru (its real flower-encyclopedia pages hardcode direct
// images.unsplash.com/photo-<id> CDN URLs with a "Фото: Unsplash"
// credit, no API call at all) — Unsplash's own license permits direct
// hotlinking to a specific already-published photo without
// authentication; only their *search/random* API endpoints require a
// registered Access Key. Every URL below was found via a real Unsplash
// search (unsplash.com/s/photos/<query>) and verified live (HTTP 200)
// before being hardcoded here — never a plus.unsplash.com/premium_photo
// (paid-tier, not free) or a /flagged/ path.
interface UnsplashPick {
  /** Matched against Article.headline via a case-insensitive substring check. */
  headlineContains: string;
  photoId: string;
  altText: string;
}

const PICKS: UnsplashPick[] = [
  { headlineContains: "Family Replaces Second Vehicle with Cargo E-Bike", photoId: "1671387863866-90072d09b11d", altText: "A cargo e-bike, generic lifestyle photo" },
  { headlineContains: "E-bike and power station sales heat up ahead of Labor Day", photoId: "1717753045265-fa6ab160384a", altText: "Family riding e-bikes, generic lifestyle photo" },
  { headlineContains: "China's Solar Capacity Now Exceeds Coal", photoId: "1583345237708-add35a664d77", altText: "A house with rooftop solar panels, generic photo" },
  { headlineContains: "Expert Guidance on Home Solar Questions", photoId: "1660330589257-813305a4a383", altText: "A worker installing rooftop solar panels, generic photo" },
  { headlineContains: "Labor Day Sales Offer Discounts on EV Chargers", photoId: "1593941707874-ef25b8b4a92b", altText: "An EV charging cable plugged into a car, generic photo" },
  { headlineContains: "Battery EVs surpass petrol sales in Australia", photoId: "1615829386703-e2bb66a7cb7d", altText: "An electric car charging on a city street, generic photo" },
  { headlineContains: "UK Electric Vehicles Capture Market Lead", photoId: "1639302610362-4c86747e8680", altText: "An electric car plugged into a charging station, generic photo" },
  { headlineContains: "US battery storage hits record quarterly growth", photoId: "1589276534126-adef63a95e05", altText: "Solar panels under a clear sky, generic energy photo" },
];

async function main() {
  for (const pick of PICKS) {
    const article = await prisma.article.findFirst({
      where: { status: "PUBLISHED", type: "NEWS", headline: { contains: pick.headlineContains, mode: "insensitive" }, images: { none: { role: "HERO" } } },
      select: { id: true, headline: true },
    });
    if (!article) {
      console.log(`- no matching imageless article found for "${pick.headlineContains}" (already has an image, or headline changed)`);
      continue;
    }

    const url = `https://images.unsplash.com/photo-${pick.photoId}?w=1200&q=80`;
    const { sha256 } = await hashRemoteImage(url);
    const existing = await prisma.image.findUnique({ where: { sha256 } });
    const imageId = existing
      ? existing.id
      : (
          await prisma.image.create({
            data: {
              originalUrl: url,
              sourceType: "LICENSED_STOCK",
              rightsStatus: "VERIFIED_LICENSE",
              author: "Unsplash",
              attribution: "Photo: Unsplash",
              // No dedicated License row for Unsplash's own free-to-use
              // license (Commons/Openverse's licenseId FK expects a
              // Commons-shaped license, which this isn't) — real, honest
              // gap: licenseId stays null rather than misrepresenting
              // this as one of the Creative Commons variants.
              width: 1200,
              height: null,
              mimeType: "image/jpeg",
              sha256,
              generatedByAi: false,
            },
          })
        ).id;
    await prisma.articleImage.create({ data: { articleId: article.id, imageId, role: "HERO", position: 0, altText: pick.altText } });
    console.log(`✓ attached Unsplash photo to "${article.headline}"`);
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
