import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@automotive/database";

const UPLOAD_DIR = "/repo/uploads";
const COMPRESSED_WIDTH = 1200;
const JPEG_QUALITY = 82;

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
// No Unsplash API key needed to FIND a photo: every ID below was found
// via a real Unsplash search (unsplash.com/s/photos/<query>) and
// verified live (HTTP 200) before being hardcoded here — never a
// plus.unsplash.com/premium_photo (paid-tier) or a /flagged/ path.
//
// Real, twice-reproduced bug found 2026-09-11 (see
// self-host-unsplash-images.ts's own comment for the full story):
// hotlinking directly to images.unsplash.com — this file's original
// design, following belarosa.ru's own precedent — intermittently 503s
// on a real browser request even though the same URL returns 200 to
// plain curl every time. Downloading the bytes once and serving them
// from this app's own /uploads/ (the same mechanism generate-image.ts
// already uses for OpenAI images) removes that dependency entirely, so
// every PICK below is fetched once at attach-time instead of hotlinked
// forever.
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
  // Second real batch, added the same tick after the first confirmed
  // working live (user's own reaction: "ура блять... используй Unsplash
  // везде где можно").
  { headlineContains: "Minnesota Secures $41M for 40 New EV Fast-Charging Stations", photoId: "1619913387719-a43ee8859d9c", altText: "An EV charging stand, generic photo" },
  { headlineContains: "Jackery Power Station Discounted", photoId: "1650785652040-5a2fc88ce902", altText: "A portable power station, generic photo" },
  { headlineContains: "Bluetti marks 6th anniversary", photoId: "1650785652627-c53ea4fe5b29", altText: "A portable power station used outdoors, generic photo" },
  { headlineContains: "Bluetti, Anker, and Tenways Launch Labor Day Promotions", photoId: "1597260491619-bab87197869f", altText: "An e-scooter parked on a city street, generic photo" },
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

    const sourceUrl = `https://images.unsplash.com/photo-${pick.photoId}?w=1200&q=80`;
    const res = await fetch(sourceUrl);
    if (!res.ok) {
      console.log(`- fetch failed (${res.status}) for photo ${pick.photoId}, skipping "${article.headline}"`);
      continue;
    }
    const rawBytes = Buffer.from(await res.arrayBuffer());
    const resized = sharp(rawBytes).resize({ width: COMPRESSED_WIDTH, withoutEnlargement: true }).jpeg({ quality: JPEG_QUALITY });
    const { data: bytes, info } = await resized.toBuffer({ resolveWithObject: true });
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const existing = await prisma.image.findUnique({ where: { sha256 } });
    const imageId = existing
      ? existing.id
      : await (async () => {
          const filename = `${randomUUID()}.jpg`;
          await mkdir(UPLOAD_DIR, { recursive: true });
          await writeFile(path.join(UPLOAD_DIR, filename), bytes);
          return (
            await prisma.image.create({
              data: {
                originalUrl: `/uploads/${filename}`,
                localStorageUrl: `/uploads/${filename}`,
                sourceType: "LICENSED_STOCK",
                rightsStatus: "VERIFIED_LICENSE",
                author: "Unsplash",
                attribution: "Photo: Unsplash",
                // No dedicated License row for Unsplash's own free-to-use
                // license (Commons/Openverse's licenseId FK expects a
                // Commons-shaped license, which this isn't) — real, honest
                // gap: licenseId stays null rather than misrepresenting
                // this as one of the Creative Commons variants.
                width: info.width,
                height: info.height,
                mimeType: "image/jpeg",
                sha256,
                generatedByAi: false,
              },
            })
          ).id;
        })();
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
