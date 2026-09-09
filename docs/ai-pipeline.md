# AI Pipeline

**Corrected 2026-09-08**: this entire document reads in present tense,
as if the pipeline it describes were largely built and running — it
isn't. Checked directly rather than assumed: zero real code anywhere
writes to or reads `AIJob`, `AIExecution`, `PromptTemplate`,
`PromptVersion`, or `AIAgentAction` via Prisma (grepped every
`apps/*/src`/`packages/*/src` file); `packages/ai/src/budget.ts`'s
`assertWithinBudget()` (the "guard checked before every provider call"
below) has zero callers outside its own file — there is no real
provider call anywhere yet to guard; `AI_KILL_SWITCH` is parsed as a
feature flag in `packages/config` but is never actually READ/enforced
anywhere in `apps/worker` or any job-processing code — there is no
"worker's job-picker loop" in real code, because there is no AI job
queue in real code. **What's actually real today**: the Ingest stage
(RSS/Atom fetch, no AI, `apps/worker`) and the non-AI parts of
duplicate detection/clustering (URL-hash + `pg_trgm` title similarity
— genuinely real, tested, running against real feeds) exist. Every
other stage below (Researcher, Fact Extractor, Fact Checker, Writer,
SEO Editor, Quality Controller, Moderator), the Article/ArticleRevision
lifecycle (blocked on `Article` itself being unbuilt — see README.md's
status table), and the kill switch/budget guard's actual enforcement
are all still exactly what this document was always meant to be: the
intended design to build once resourced. **Updated 2026-09-08**: a
real `AnthropicProvider` (`packages/ai/src/providers/anthropic-provider.ts`,
`claude-haiku-4-5` by default — see README's `packages/ai` row) now
implements `AIProvider.complete()` for real against the actual
Anthropic Messages API, unit-tested against a mocked client (5/5
passing) — this closes the "only a no-op test provider exists" gap.
**Updated again 2026-09-08, same day**: both of those gaps just closed
for real. A real `ANTHROPIC_API_KEY` is now configured (production only,
on the deployed VPS — see project memory, not committed anywhere), and
`apps/worker/src/write-article.ts` is a real first Writer stage: it
picks real Stories with no English Article yet, calls
`createTextProvider()` → a real `AnthropicProvider` → `claude-haiku-4-5`,
through the real `assertWithinBudget()`/`recordExecution()` guard (a real
`AIJob` row per Story, type `WRITE_ARTICLE`), and writes a real
`Article` + `ArticleBlock` rows, `status: PUBLISHED`. **Live-verified for
real, not just unit-tested**: run against the real production DB/API,
9 real Stories → 9 real published articles (e.g. "Volkswagen ID. Polo EV
Faces Months-Long Waitlist Due to High Demand"), each readable at
`/articles/en/:slug` (new `apps/api` route + `apps/web` page, see
README). **Real, live-discovered API constraint** (not documented
anywhere beforehand, found via an actual 400): `output_config.format`'s
JSON Schema only accepts array `minItems`/`maxItems` of 0 or 1 — a
desired paragraph-count range has to live in the field's `description`
text instead of an enforced schema constraint; documented directly in
`AnthropicProvider`'s own comment for the next stage author who hits it.
This Writer stage is deliberately the honest minimum, not the full
9-stage design: it drafts directly from the Story's title/summary and
its SourceArticles' short excerpts — **no independent Researcher stage,
no formal Fact Checker pass** exist yet, so what's live today is
"synthesize from what Ingest already gathered," not the spec's full
research→fact-check→write chain. **`AI_KILL_SWITCH` closed for real,
same day, next pass**: `apps/worker/src/index.ts` now calls
`runWriteArticleBatch()` (exported from `write-article.ts`, the CLI
entrypoint refactored so `apps/worker`'s own long-running process can
call it directly rather than spawning a subprocess) on a real periodic
timer (`WRITE_ARTICLES_INTERVAL_SECONDS`, default 900s) — and only
schedules it at all if `AI_KILL_SWITCH` is off AND a real
`ANTHROPIC_API_KEY` is configured, logging which of the two blocked it
otherwise. This is the first real AI-calling loop anywhere in the
codebase, so it's also the first place the switch had anything to
guard — every earlier mention of "parsed but never checked" is now
specifically about the per-story budget/kill-switch check happening
once per scheduling cycle (before a batch starts), not per individual
`writeOne()` call within an already-started batch. Kept the rest of
this document unchanged below — it's a legitimate, still-current design
reference for building the remaining stages (Researcher, Fact Extractor,
Fact Checker, SEO Editor, Quality Controller, Moderator) — but read
every present-tense claim below as "designed for," not "already does,"
except where this note says otherwise.

## Principle (spec §3, §86)

Never one giant prompt. Every stage is a separate, specialized step with a
typed input, a schema-validated output, its own retry policy, and its own
log row (`AIExecution`). A stage that fails doesn't corrupt the ones after
it — it fails the `AIJob`, which retries or surfaces to
`docs/security.md`'s alerting, while other stages/other stories keep moving.

```text
Classifier → Clusterer → Researcher → Fact Extractor → Fact Checker
  → Writer → SEO Editor → Quality Controller → Moderator
```

## Pipeline stages and what each one owns

| Stage | Input | Output | Notes |
|---|---|---|---|
| Ingest | `Source` | `SourceArticle` | RSS/Atom/API fetch — see `apps/worker`, no AI involved |
| Duplicate detection | new `SourceArticle` | same-article / same-story / related-story verdict | URL hash first (cheap), then `pg_trgm` title similarity, then embeddings once pgvector is live (docs/database.md) |
| Clusterer | `SourceArticle` group | `Story` (created or updated) | AI-assisted once `AUTO_CLUSTER=true`; until then, dedup groups by shared URL-hash/title-similarity only — no LLM call yet |
| Researcher | `Story` | `ResearchPackage` (primary sources, conflicts, timeline, `KnowledgeDelta` vs. existing site content) | Extension §20-22; must check existing Articles/Facts *before* concluding new research is needed |
| Fact Extractor | `Story` + `SourceArticle[]` | `Fact[]` + `FactEvidence[]` | Structured JSON only, schema-validated — never freeform text into a numeric field (spec §87) |
| Fact Checker | `Fact[]` | `FactConflict[]` resolved/unresolved + status transitions (`CONFIRMED`/`REPORTED`/...) | Confidence ≠ truth (spec §88) — status changes need evidence, not just a model's confidence score |
| Writer (Editorial Synthesis) | verified `Fact[]` + `ResearchPackage` + existing Knowledge Graph | `Article` (blocks, not prose blob) | One independent pass per locale (EN, then ES) — never EN→translate→ES (spec §21) |
| SEO Editor | `Article` | `SEORecord` (structured data, canonical, meta) | |
| Quality Controller | `Article` | `qualityScore`/`originalityScore`/`factualScore`/`sourceScore`/`valueScore`/`readabilityScore` → `publish`/`review`/`reject` | Thresholds live in `packages/config`, not hardcoded |
| Moderator | `Comment` | `moderation_status` | Runs continuously, independent of the editorial pipeline |

## Story lifecycle

```text
DISCOVERED → CLUSTERING → RESEARCHING → FACT_CHECK → EDITORIAL_DRAFT
  → QUALITY_CHECK → READY → PUBLISHED → UPDATED → ARCHIVED
```

`Story.status` drives which `AIJobType` gets queued next; a story can loop
back from `UPDATED` to `RESEARCHING` when new `SourceArticle`s attach to it
(spec §52 story evolution) — it does not spawn a sibling Story for the same
event.

## Article lifecycle

```text
DRAFT → IN_REVIEW → SCHEDULED → PUBLISHED → UPDATED → ARCHIVED
                                     ↓
                                 REJECTED (from IN_REVIEW, quality gate fail)
```

Every transition writes an `ArticleRevision` with `authorType` (`HUMAN` /
`AI_AGENT` / `HYBRID`) and a diff — see docs/security.md for why this is
also an audit requirement, not just editorial nicety.

## AIProvider abstraction (`packages/ai`)

```ts
interface AIProvider {
  complete(input: CompletionRequest): Promise<CompletionResult>
  embed(input: EmbeddingRequest): Promise<EmbeddingResult>
}
```

Concrete providers (Anthropic, OpenAI, a future local model) implement this
one interface. Which provider handles which pipeline stage is config, not
code (`AI_DEFAULT_TEXT_PROVIDER` / `AI_DEFAULT_EMBEDDING_PROVIDER` in
`.env.example`) — classification, embeddings, research, fact-checking,
writing, vision, and moderation can each point at a different model without
touching pipeline code (spec §46).

## Budget control (spec §45)

Every `AIExecution` row records `tokensIn`/`tokensOut`/`estimatedCostUsd`.
A guard (`assertWithinBudget()`, `packages/ai/src/budget.ts`) checked
before every provider call compares running spend against
`AI_DAILY_BUDGET_USD` / `AI_MONTHLY_BUDGET_USD` / `AI_PER_TASK_MAX_USD`,
throwing `BudgetExceededError` on overage; `handleBudgetExceeded(jobId,
error)` in the same file turns that into the real effect: the job is left
`PENDING` (not failed — it resumes once budget resets) and a `SystemAlert`
(`WARNING`) is raised. Both halves are real and covered by real
integration tests today — what's still missing is a real pipeline stage
that calls them (blocked on a live provider API key, same as the rest of
this document's designed-not-built stages).

## Prompt management (spec §73)

`PromptTemplate` (a stable key like `article_writer`) + `PromptVersion`
(the actual text, versioned, one `isActive` at a time). Changing a prompt
is a database write, not a deploy. `AIExecution.promptTemplateId` +
`promptVersion` make every generation reproducible after the fact (spec
§72).

## Autonomy levels (spec §41, §75)

| Level | Examples | Gate |
|---|---|---|
| SAFE | clustering, tagging, summarization, dedup, source health checks | runs automatically once its `AUTO_*` flag is on |
| CONTROLLED | publication, article update, image selection, SEO changes | policy/threshold-gated — quality gate score, budget, or explicit human approval depending on config |
| HIGH_RISK | deleting major articles, legal responses, copyright calls, critical system settings, large spend, external communication | always human approval, never automatable regardless of flags |

`AIAgentAction.autonomyLevel` records which bucket every action fell into,
so an audit can answer "did the agent ever do something HIGH_RISK on its
own" with a query, not a guess.

## Kill switch (spec §76)

`AI_KILL_SWITCH=true` (env, hot-reloadable from the admin — not a redeploy)
stops all `AIJob` processing and blocks `PUBLISH_ARTICLE`/external actions
immediately, while the public site keeps serving already-published content
normally. This check happens once, centrally, in the worker's job-picker
loop — not scattered across every job handler.
