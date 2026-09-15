import { prisma } from "@automotive/database";
import { discoverGenerationSections } from "./generation-sections.js";
import { fetchCommonsFileInfo } from "./commons-search.js";
import { attachCarModelPhoto } from "./attach-car-photo.js";
import { seedEpaTrimsForNameplate } from "./epa-trims.js";

// Shared core extracted 2026-09-15 from apply-generation-sections.ts's
// original single-model CLI, so backfill-all-generations.ts (unattended,
// whole-catalog sweep) can call the exact same logic per model instead
// of shelling out to a separate process per row.

const CURRENT_YEAR = new Date().getFullYear();

export type ApplyResult =
  | { status: "applied"; generations: number; trims: number }
  | { status: "too_few_sections"; sectionsFound: number }
  | { status: "error"; message: string };

export async function applyGenerationSectionsForModel(
  brandSlug: string,
  brandName: string,
  modelSlug: string,
  modelName: string,
  carModelId: string,
  wikipediaTitleOverride?: string,
): Promise<ApplyResult> {
  const wikipediaTitle = wikipediaTitleOverride ?? `${brandName} ${modelName}`;
  let sections: Awaited<ReturnType<typeof discoverGenerationSections>>;
  try {
    sections = await discoverGenerationSections(wikipediaTitle);
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
  if (sections.length < 2) return { status: "too_few_sections", sectionsFound: sections.length };

  const createdGenerations: { id: string; slug: string }[] = [];
  for (const section of sections) {
    const gen = await prisma.generation.upsert({
      where: { carModelId_slug: { carModelId, slug: section.slug } },
      update: {},
      create: { carModelId, slug: section.slug, name: section.name, startYear: section.startYear, endYear: section.endYear },
    });
    createdGenerations.push({ id: gen.id, slug: gen.slug });

    if (section.infobox?.image) {
      const filename = section.infobox.image.split("|")[0]?.trim();
      const file = filename ? await fetchCommonsFileInfo(filename) : null;
      if (file) {
        await attachCarModelPhoto(
          carModelId,
          {
            sourceUrl: file.fullUrl,
            provider: "Wikimedia Commons",
            licenseSlug: file.licenseSlug,
            licenseUrl: file.licenseUrl,
            attributionRequired: file.attributionRequired,
            artist: file.artist,
            altText: `${brandName} ${modelName} (${section.name})`,
          },
          "GALLERY",
          createdGenerations.length,
          gen.id,
        );
      }
    }
  }

  const lastGen = createdGenerations[createdGenerations.length - 1]!;
  const existingHero = await prisma.carModelImage.findFirst({ where: { carModelId, role: "HERO", position: 0 } });
  if (existingHero && existingHero.generationId !== lastGen.id) {
    const currentGenId = existingHero.generationId;
    const stillPlaceholder = currentGenId
      ? (await prisma.generation.findUnique({ where: { id: currentGenId } }))?.slug === "overview"
      : true;
    if (stillPlaceholder) {
      await prisma.carModelImage.update({ where: { id: existingHero.id }, data: { generationId: lastGen.id } });
    }
  }

  let totalTrims = 0;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    const gen = createdGenerations[i]!;
    const preferredYear = Math.min(section.endYear ?? CURRENT_YEAR - 1, CURRENT_YEAR - 1);
    if (preferredYear < (section.startYear ?? 1980)) continue;
    try {
      totalTrims += await seedEpaTrimsForNameplate(gen.id, brandName, modelName, preferredYear);
    } catch {
      // EPA has nothing for this make/model/year often enough (non-US
      // markets, very old or very new nameplates) that this is expected.
    }
  }

  const overview = await prisma.generation.findFirst({ where: { carModelId, slug: "overview" } });
  if (overview) {
    const strandedTrims = await prisma.trim.count({ where: { generationId: overview.id } });
    const strandedPhotos = await prisma.carModelImage.count({ where: { generationId: overview.id } });
    if (strandedTrims === 0 && strandedPhotos === 0) {
      await prisma.generation.delete({ where: { id: overview.id } });
    }
  }

  return { status: "applied", generations: sections.length, trims: totalTrims };
}
