import { prisma } from "@automotive/database";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

// One-shot CLI entrypoint (`npm run backfill:x5-photos-g65 --workspace
// @automotive/worker`). Two more real gaps the user found by asking
// directly (2026-09-14): (1) the X5 catalog page had exactly ONE photo
// total — the current G05, still hotlinked from thumb.wikimedia.org
// rather than self-hosted — and zero photos for E53/E70/F15; (2) BMW
// has already officially revealed a real fifth generation (G65,
// unveiled June 30 2026, on sale from November 28 2026) that this entry
// didn't have at all.
//
// Sources (fetched 2026-09-14):
// - https://www.bmwblog.com/2026/06/30/2027-bmw-x5-details-specs-photo-price/
//   — official BMW reveal, cross-referencing BMW's own published specs:
//   on-sale dates, 5 powertrain types, real hp figures for 4 of them
//   (X5 40 gas, X5 50e xDrive PHEV, X5 M60e xDrive PHEV, iX5 60 xDrive
//   electric). Diesel and hydrogen variants are confirmed to exist but
//   without a published hp figure yet (hydrogen not arriving until
//   ~2028) — left out rather than guessed.
// - Wikimedia Commons photos for E53/E70/F15, each viewed directly
//   before use. No real G65 photo exists on Commons yet (genuinely too
//   new) — left without one rather than substituting a stand-in.

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "bmw" } });
  if (!brand) throw new Error("BMW brand not found.");
  const x5 = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: "x5" } } });
  if (!x5) throw new Error("X5 CarModel not found.");

  // --- Self-host the existing G05 hero (was hotlinked) + reposition,
  // then add one real gallery photo per older generation. ---
  const existingHero = await prisma.carModelImage.findFirst({ where: { carModelId: x5.id, role: "HERO", position: 0 } });
  if (existingHero) {
    const heroImage = await prisma.image.findUnique({ where: { id: existingHero.imageId } });
    if (heroImage?.originalUrl.startsWith("http")) {
      console.log("  Existing HERO is still hotlinked — replacing with a self-hosted copy of the same photo.");
      await prisma.carModelImage.delete({ where: { id: existingHero.id } });
      await attachCarModelPhoto(
        x5.id,
        {
          sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/9/96/BMW_X5_%28G05%29_China.jpg",
          provider: "Wikimedia Commons",
          licenseSlug: "cc-by-sa-4.0",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
          attributionRequired: true,
          artist: "Dinkun Chen",
          altText: "BMW X5 (G05), fourth generation",
        },
        "HERO",
        0,
      );
    }
  }

  await attachCarModelPhoto(
    x5.id,
    {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/1/10/BMW_E53_X5_3.0_Titanium_Silver_Metallic_%284%29.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc-by-sa-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attributionRequired: true,
      artist: "Damian B Oh",
      altText: "BMW X5 (E53), first generation, in Titanium Silver Metallic",
    },
    "GALLERY",
    1,
  );
  await attachCarModelPhoto(
    x5.id,
    {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/0/03/2010_BMW_E70_X5_M.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "pd",
      licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
      attributionRequired: false,
      artist: "Dabombazzz",
      altText: "BMW X5 M (E70), second generation, front close-up",
    },
    "GALLERY",
    2,
  );
  await attachCarModelPhoto(
    x5.id,
    {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/6/6b/2016_BMW_X5_xDrive35i_%28US%29_front_3.9.18.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc-by-sa-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      attributionRequired: true,
      artist: "Kevauto",
      altText: "BMW X5 xDrive35i (F15), third generation",
    },
    "GALLERY",
    3,
  );

  // --- G65, fifth generation (officially revealed June 30, 2026) ---
  const g65 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: x5.id, slug: "g65" } },
    update: {},
    create: { carModelId: x5.id, slug: "g65", name: "G65 (fifth generation, Neue Klasse)", startYear: 2026, endYear: null },
  });

  type TrimSpec = { slug: string; name: string; engineName: string; powerHp: number; fuel: string };
  const g65Trims: TrimSpec[] = [
    { slug: "x5-40", name: "X5 40 (on sale Nov 28, 2026)", engineName: "3.0L Turbo I6 (B58)", powerHp: 394, fuel: "petrol" },
    { slug: "x5-50e-xdrive", name: "X5 50e xDrive (plug-in hybrid, on sale March 2027)", engineName: "Turbo I6 + electric motor, combined", powerHp: 483, fuel: "phev" },
    { slug: "x5-m60e-xdrive", name: "X5 M60e xDrive (plug-in hybrid, on sale March 2027)", engineName: "Turbo I6 + electric motor, combined", powerHp: 603, fuel: "phev" },
    { slug: "ix5-60-xdrive", name: "iX5 60 xDrive (fully electric, on sale March 2027)", engineName: "Dual electric motors, AWD", powerHp: 570, fuel: "electric" },
  ];
  for (const t of g65Trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: g65.id, slug: t.slug } },
      update: {},
      create: { generationId: g65.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, fuel: t.fuel } });
    }
  }

  const existingFact = await prisma.fact.findFirst({ where: { carModelId: x5.id, attribute: "fifth_generation_revealed" } });
  if (!existingFact) {
    await prisma.fact.create({
      data: {
        carModelId: x5.id,
        attribute: "fifth_generation_revealed",
        value:
          "BMW officially revealed the fifth-generation X5 (G65) on June 30, 2026 — its first Neue Klasse model with a combustion engine. Gas and diesel versions go on sale November 28, 2026; the plug-in hybrid and fully-electric iX5 follow on March 6, 2027. A hydrogen fuel-cell variant is planned for around 2028 but wasn't detailed at the reveal. No real photo of this generation exists on Commons yet, so this catalog entry doesn't have one either rather than substituting a stand-in.",
        status: "CONFIRMED",
        confidence: 0.85,
      },
    });
  }

  console.log(`Backfilled: X5 photos (self-hosted hero + 3 per-generation gallery) and G65 (${g65.id}, ${g65Trims.length} trims).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
