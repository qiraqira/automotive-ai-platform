import { prisma } from "@automotive/database";
import { attachCarModelPhoto } from "./lib/attach-car-photo.js";

// One-shot CLI entrypoint (`npm run backfill:gle-history --workspace
// @automotive/worker`). Same completeness pass just applied to the BMW
// X5, now for the Mercedes-Benz GLE — the second model taken to this
// standard rather than starting a new brand, per the user's own
// "finish one before starting another" rule.
//
// Real gap: this entry only had the current W167 generation (since
// 2018). The GLE nameplate itself only exists in EPA's own records
// starting 2016 — before that it was sold as the Mercedes-Benz M-Class
// — and this session's fetch:epa-history sweep confirmed a real,
// distinct first generation, W166, sold under the GLE name from the
// 2016 model year through 2019 (production dates back to July 2011 as
// the M-Class before the rename). Also fixes the same hotlinked-photo/
// no-generation-link gap the X5 entry had.
//
// Sources (fetched 2026-09-14):
// - fetchNameplateHistory("Mercedes-Benz", "GLE", 1998, 2026) — real EPA
//   model-year records confirming the GLE name starts in 2016 and the
//   W166-era trim names (GLE400, AMG GLE43, AMG GLE63 S, GLE550e, ...)
// - Wikipedia's "Mercedes-Benz M-Class" article (covers W166/GLE-rename
//   history and trim hp/torque — no separate "GLE (W166)" article
//   exists, since the GLE was originally just a renamed, facelifted
//   M-Class rather than an all-new model)

async function main() {
  const brand = await prisma.brand.findUnique({ where: { slug: "mercedes-benz" } });
  if (!brand) throw new Error("Mercedes-Benz brand not found.");
  const gle = await prisma.carModel.findUnique({ where: { brandId_slug: { brandId: brand.id, slug: "gle" } } });
  if (!gle) throw new Error("GLE CarModel not found.");
  const w167 = await prisma.generation.findFirst({ where: { carModelId: gle.id, slug: "w167" } });
  if (!w167) throw new Error("W167 generation not found — expected from the original seed-real-cars.ts run.");

  // --- W166 (2016-2019 as "GLE"; the same chassis was sold as the
  // M-Class from July 2011 before the 2015/2016 rename) ---
  const w166 = await prisma.generation.upsert({
    where: { carModelId_slug: { carModelId: gle.id, slug: "w166" } },
    update: {},
    create: { carModelId: gle.id, slug: "w166", name: "W166 (first generation as \"GLE\"; sold 2011-2015 as the M-Class)", startYear: 2016, endYear: 2019 },
  });

  type TrimSpec = { slug: string; name: string; engineName: string; powerHp: number; fuel: string };
  const w166Trims: TrimSpec[] = [
    { slug: "gle400", name: "GLE400 4MATIC", engineName: "3.0L Twin-Turbo V6 (M276)", powerHp: 328, fuel: "petrol" },
    { slug: "amg-gle43", name: "AMG GLE43 4MATIC", engineName: "3.0L Twin-Turbo V6 (M276)", powerHp: 362, fuel: "petrol" },
    { slug: "amg-gle63-s", name: "AMG GLE63 S 4MATIC", engineName: "5.5L Twin-Turbo V8 (M157)", powerHp: 577, fuel: "petrol" },
    { slug: "gle550e", name: "GLE550e 4MATIC (plug-in hybrid)", engineName: "3.0L V6 + electric motor, combined", powerHp: 449, fuel: "phev" },
  ];
  for (const t of w166Trims) {
    const trim = await prisma.trim.upsert({
      where: { generationId_slug: { generationId: w166.id, slug: t.slug } },
      update: {},
      create: { generationId: w166.id, slug: t.slug, name: t.name },
    });
    if ((await prisma.engine.count({ where: { trimId: trim.id } })) === 0) {
      await prisma.engine.create({ data: { trimId: trim.id, name: t.engineName, powerHp: t.powerHp, fuel: t.fuel } });
    }
  }

  // --- Self-host + link the existing W167 hero, which was still
  // hotlinked and had no generation link. ---
  const existingHero = await prisma.carModelImage.findFirst({ where: { carModelId: gle.id, role: "HERO", position: 0 } });
  if (existingHero) {
    const heroImage = await prisma.image.findUnique({ where: { id: existingHero.imageId } });
    if (heroImage?.originalUrl.startsWith("http")) {
      console.log("  Existing HERO is still hotlinked — replacing with a self-hosted, generation-linked copy.");
      await prisma.carModelImage.delete({ where: { id: existingHero.id } });
      await attachCarModelPhoto(
        gle.id,
        {
          sourceUrl:
            "https://upload.wikimedia.org/wikipedia/commons/7/77/Mercedes-Benz_GLE_450%2C_GIMS_2019%2C_Le_Grand-Saconnex_%28GIMS1254%29.jpg",
          provider: "Wikimedia Commons",
          licenseSlug: "cc-by-sa-4.0",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
          attributionRequired: true,
          artist: "Matti Blume",
          altText: "Mercedes-Benz GLE 450 (W167), second generation",
        },
        "HERO",
        0,
        w167.id,
      );
    } else if (!existingHero.generationId) {
      await prisma.carModelImage.update({ where: { id: existingHero.id }, data: { generationId: w167.id } });
      console.log("  Existing HERO already self-hosted — linked it to the W167 generation.");
    }
  }

  // --- Real, human-verified W166 gallery photo ---
  await attachCarModelPhoto(
    gle.id,
    {
      sourceUrl: "https://upload.wikimedia.org/wikipedia/commons/4/41/2016_Mercedes-Benz_GLE_350.jpg",
      provider: "Wikimedia Commons",
      licenseSlug: "cc0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/deed.en",
      attributionRequired: false,
      artist: "Carlito714",
      altText: "Mercedes-Benz GLE 350 (W166), first generation as \"GLE\", rear three-quarter view",
    },
    "GALLERY",
    1,
    w166.id,
  );

  console.log(`Backfilled: Mercedes-Benz GLE (${gle.id}), W166 (${w166.id}, ${w166Trims.length} trims), W167 photo self-hosted+linked.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
