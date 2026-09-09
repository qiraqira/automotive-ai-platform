# Editorial System

## The core question order (spec §67, extension "MOST IMPORTANT REQUIREMENT")

Every content decision goes through this order, not "how do I rewrite this
article":

```text
What do we know about this event?
What is new?
What sources confirm it?
What already exists on our site?
What knowledge gap exists?
What new value can we give the reader?
  → only then: what piece of content should exist?
```

## Content graph, not a pile of articles (extension §1-§3)

```text
GLOBAL SOURCES → SOURCE ARTICLES → STORY ENGINE → FACT ENGINE
  → KNOWLEDGE GRAPH → EDITORIAL CONTENT LAYER
        ├→ NEWS         (Article.type = NEWS/BREAKING_NEWS)
        ├→ EXPLAINER     (ArticleType.EXPLAINER / ANALYSIS / COMPARISON)
        └→ DATABASE       (CarModel/Generation/Trim car pages)
```

`Article.contentPurpose` (`BREAKING`/`UPDATE`/`BACKGROUND`/`ANALYSIS`/
`EXPLAINER`/`COMPARISON`/`GUIDE`/`HISTORY`/`DATABASE`/`MARKET`/`TECHNOLOGY`)
is the field that lets several articles about the same `Story`/`CarModel`
coexist without competing — a `NEWS` piece on a launch and a `COMPARISON`
piece against a competitor are different `contentPurpose` values pointing
at the same `storyId`/`carModelId`, not duplicate coverage.

## Cannibalization prevention (extension §5-§6)

Before creating any `Article`, the `ContentCompositionEngine`
(`packages/editorial`) must check for existing articles with the same
`storyId`/`carModelId` **and** the same `contentPurpose`. Outcomes:

```text
CREATE   — no existing article with this purpose covers this story/car
UPDATE   — an existing article with this exact purpose exists; extend it,
           write a new ArticleRevision, don't fork a near-duplicate
MERGE    — two existing articles have converged on the same purpose
SPLIT    — one existing article has grown to cover two distinct purposes
REJECT   — the new content adds no KnowledgeDelta over what already exists
```

## KnowledgeDelta (extension §8)

For every Story, before writing anything: diff the new facts against
`Fact` rows already in the database for the same `carModelId`/attribute.

```text
existing: Model Y range = 320 miles (Fact#123, valid_to=null)
new source: Model Y range = 337 miles

KnowledgeDelta = +17 miles → real, worth an UPDATE
```

`KnowledgeDelta ≈ 0` → the quality gate should default to `REJECT`/review,
not publish a near-identical article just because a new `SourceArticle`
arrived (extension §8, §50).

## Additional Value Engine (spec §18) / ValueScore (extension §50)

Before publication, every article answers: *what does this add beyond the
sources?* One or more of: comparison, technical explanation, historical
context, timeline, pricing, specs, market context, previous generation,
competitor comparison, related events. `ValueScore = originality +
research_depth + knowledge_delta + utility + source_quality + context`; a
low score routes to `IN_REVIEW`, never straight to `PUBLISHED`.

## Source reliability and independence (extension §18-§20, §52-§53)

`Source.trustScore` (0-100) starts from a static table (official
manufacturer 100, wire service 95, established specialist media 80,
regional 75, unknown blog 30, social 10) and then **moves** based on actual
track record (`SourceScoreEvent`, append-only) — a source that breaks real
stories first and gets corroborated earns score; one that retracts or gets
contradicted loses it. `trustScore` is never treated as ground truth on its
own — it weighs conflict resolution, it doesn't decide it outright.

Independence matters more than raw count: ten outlets re-publishing one
manufacturer press release are one information origin, not ten confirming
sources (extension §52-53) — the research stage must trace claims back to
shared origin before counting them as independent corroboration.

## No fake authority (spec §70)

The system never invents journalists, interviews, quotes, test drives, or
personal experience, and never fabricates a source. Every `Article` records
`authorType` (`HUMAN`/`AI_AGENT`/`HYBRID`) — this is a first-class,
user-visible fact, not internal metadata to hide.

## Corrections (spec §68-69)

An error found after publication is never silently rewritten. It becomes an
`ArticleRevision` (`changeType = "correction"`) with a `reason`, and the
article's visible state reflects the update per spec §69 — history is
preserved, not erased.
