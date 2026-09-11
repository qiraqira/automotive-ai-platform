import { prisma } from "@automotive/database";
import { ENTITY_TYPE } from "@automotive/types";
import { extractCarModelMentions, type CarModelCandidate } from "@automotive/editorial";

// One-shot CLI entrypoint (`npm run backfill:car-mentions --workspace apps/worker`).
//
// Real gap found 2026-09-11: apps/worker/src/ingest.ts's own
// linkStoryToCarModels() only ever runs once, at the moment a Story is
// first created — it checks the title against whatever CarModel rows
// exist in the DB *at that instant*. A CarModel added later (this
// session added Mercedes-Benz GLE, Tesla Model Y and Toyota RAV4 well
// after this project's Stories had already been ingesting for days) has
// no way to retroactively pick up an older Story that already, genuinely
// mentions it — nothing ever re-scans old titles against the current
// catalog. Confirmed live before writing this: "How Much Range The
// Tesla Model 3 And Model Y Lose After Almost 100,000 Miles" and
// "Tesla's new Model Y L is experiencing suspension failures" both
// genuinely, precisely mention "Model Y" (word-boundary match, not the
// GLE/"Eagle" substring-collision shape entity-extractor.ts's own tests
// guard against) but had zero EntityRelation edge to the real Model Y
// CarModel — meaning neither ever showed up in Model Y's own "Related
// stories" section despite being exactly the kind of real internal link
// that section exists for.
//
// Idempotent: reuses the identical extractCarModelMentions() call and
// "skip if the edge already exists" check ingest.ts's own
// linkStoryToCarModels() uses, so re-running this after adding another
// CarModel only creates the new, real edges — never duplicates.
async function loadCarModelCandidates(): Promise<CarModelCandidate[]> {
  const carModels = await prisma.carModel.findMany({
    include: { generations: { include: { trims: true } } },
  });
  return carModels.map((cm) => ({
    id: cm.id,
    matchTerms: [cm.name, ...cm.generations.flatMap((g) => g.trims.map((t) => t.name))],
  }));
}

async function main() {
  const candidates = await loadCarModelCandidates();
  console.log(`Loaded ${candidates.length} real CarModel candidate(s).`);

  const stories = await prisma.story.findMany({ select: { id: true, title: true } });
  console.log(`Scanning ${stories.length} real Story title(s) against the current catalog.`);

  let created = 0;
  for (const story of stories) {
    const matchedCarModelIds = extractCarModelMentions(story.title, candidates);
    for (const carModelId of matchedCarModelIds) {
      const existing = await prisma.entityRelation.findFirst({
        where: { fromType: ENTITY_TYPE.STORY, fromId: story.id, toType: ENTITY_TYPE.CAR_MODEL, toId: carModelId },
      });
      if (!existing) {
        await prisma.entityRelation.create({
          data: { fromType: ENTITY_TYPE.STORY, fromId: story.id, toType: ENTITY_TYPE.CAR_MODEL, toId: carModelId, relation: "mentions" },
        });
        created++;
        console.log(`  Linked: "${story.title}" -> CarModel ${carModelId}`);
      }
    }
  }

  console.log(`Done: ${created} new Story<->CarModel edge(s) created.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
