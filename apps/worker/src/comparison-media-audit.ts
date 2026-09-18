import { prisma } from "@automotive/database";

// Deterministic, no-token-cost audit of PUBLISHED comparison content
// (`npm run audit:comparison-media --workspace @automotive/worker`).
// Built 2026-09-18 as step one of "review and fix published articles
// before writing new ones" — finds, for every live COMPARISON article,
// how many real photos exist per side and whether a real video (inline
// VIDEO block, or both cars having a curated CarVideo for the automatic
// "Compare on video" section) is present, so the follow-up fixing pass
// knows exactly which articles need what instead of re-reading every
// one by hand.

const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "with", "vs", "vs.",
  "compared", "review", "news", "front", "rear", "side", "photo", "image",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 1 && !STOPWORDS.has(w)),
  );
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

async function main() {
  console.log("=== Comparison article media audit ===\n");

  const articles = await prisma.article.findMany({
    where: { status: "PUBLISHED", OR: [{ type: "COMPARISON" }, { contentPurpose: "COMPARISON" }] },
    select: {
      id: true,
      slug: true,
      headline: true,
      carModels: { select: { carModel: { select: { id: true, name: true, slug: true, brand: { select: { name: true, slug: true } } } } } },
      images: { select: { role: true, position: true, altText: true } },
      blocks: { select: { type: true }, where: { type: "VIDEO" } },
    },
    orderBy: { publishedAt: "desc" },
  });

  console.log(`PUBLISHED comparison articles: ${articles.length}\n`);

  const needsWork: string[] = [];

  for (const a of articles) {
    const cars = a.carModels.map((c) => c.carModel);
    const heroes = a.images.filter((i) => i.role === "HERO");
    const gallery = a.images.filter((i) => i.role === "GALLERY");
    const totalPhotos = a.images.length;
    const hasInlineVideo = a.blocks.length > 0;

    const carVideoCounts = cars.length
      ? await Promise.all(
          cars.map((c) => prisma.carVideo.count({ where: { carModelId: c.id, category: "OFFICIAL" } })),
        )
      : [];
    const bothHaveCuratedVideo = cars.length === 2 && carVideoCounts.every((n) => n > 0);

    let perSideNote = "";
    if (cars.length === 2) {
      const carA = cars[0]!;
      const carB = cars[1]!;
      const tokA = tokens(`${carA.brand.name} ${carA.name}`);
      const tokB = tokens(`${carB.brand.name} ${carB.name}`);
      let sideA = 0;
      let sideB = 0;
      let unattributed = 0;
      for (const img of a.images) {
        const t = tokens(img.altText ?? "");
        const oa = overlapCount(t, tokA);
        const ob = overlapCount(t, tokB);
        if (oa > 0 && oa >= ob) sideA++;
        else if (ob > 0 && ob > oa) sideB++;
        else unattributed++;
      }
      perSideNote = `${carA.brand.name} ${carA.name}: ${sideA} photo(s), ${carB.brand.name} ${carB.name}: ${sideB} photo(s)` + (unattributed ? `, ${unattributed} unattributed` : "");
      if (sideA === 0 || sideB === 0 || Math.abs(sideA - sideB) >= 2) {
        needsWork.push(`${a.slug} — PHOTO IMBALANCE (${perSideNote})`);
      }
    } else {
      perSideNote = `${cars.length} linked car model(s) (expected 2)`;
      needsWork.push(`${a.slug} — NOT LINKED TO EXACTLY 2 CAR MODELS (${cars.length})`);
    }

    if (!hasInlineVideo && !bothHaveCuratedVideo) {
      needsWork.push(`${a.slug} — NO VIDEO (no inline VIDEO block, and not both cars have a curated OFFICIAL CarVideo)`);
    }

    console.log(`"${a.headline}" (${a.slug})`);
    console.log(`  cars: ${cars.map((c) => `${c.brand.name} ${c.name}`).join(" vs ") || "(none linked)"}`);
    console.log(`  photos: ${totalPhotos} total (${heroes.length} hero, ${gallery.length} gallery) — ${perSideNote}`);
    console.log(`  video: inline VIDEO block = ${hasInlineVideo}, both cars have curated video = ${bothHaveCuratedVideo}`);
    console.log("");
  }

  console.log(`=== ${needsWork.length} issue(s) found across ${articles.length} article(s) ===`);
  for (const n of needsWork) console.log(`  - ${n}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
