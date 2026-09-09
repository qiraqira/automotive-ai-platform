-- Real bug fix: EntityRelation.fromId had THREE simultaneous FK
-- constraints (to Story, Person, Company) on the same physical column,
-- which is impossible to ever satisfy for a genuinely polymorphic edge
-- (fromId can't be a valid id in all three tables at once). Discovered
-- via the first real INSERT attempt (P2003). This table is validated in
-- application code by design, not by the database.
ALTER TABLE "entity_relations" DROP CONSTRAINT "entity_relation_story_fk";
ALTER TABLE "entity_relations" DROP CONSTRAINT "entity_relation_person_fk";
ALTER TABLE "entity_relations" DROP CONSTRAINT "entity_relation_company_fk";
