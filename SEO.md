# SEO conventions

Reference for anyone (human or AI agent) adding a new page type or editing
an existing one. Written 2026-09-11 during an SEO pass over the existing
site — it documents what's actually implemented, not an aspirational plan.

## Titles

- Root layout (`apps/web/src/app/layout.tsx`) declares a title **template**:
  `{ default: "...", template: "%s | AutoNewsFeed" }`. Every page sets its
  own `title` as a **bare string with no site-name suffix** — Next appends
  `| AutoNewsFeed` automatically. Never hardcode the suffix in a page's own
  title.
- Exception: the root `/` page (`apps/web/src/app/page.tsx`) does NOT
  inherit the layout's title template — verified live, Next.js resolves
  the root layout+page pair as one segment rather than templating
  across it. It's the one page that manually appends `| AutoNewsFeed`
  to its own title string. Every other route templates correctly.
- Build the title from real, currently-rendered content only. If a section
  wouldn't render (no crash-test data, no related news), its keyword
  doesn't belong in the title — see `buildCarPageCopy()` in
  `apps/web/src/app/cars/[brand]/[model]/page.tsx` for the pattern: start
  from a base phrase, append a keyword only when the corresponding data
  array is non-empty.
- The visible `<h1>` and the `<title>` don't have to match word-for-word.
  The title can carry the fuller "X: Specs, Generations & Safety"
  long-tail phrasing; the H1 stays close to what a human would actually
  write as a heading (e.g. "BMW X5", not a keyword-stuffed sentence).

## Meta descriptions

- One real sentence (or two) describing what's actually on the page.
  Never invent numbers, ratings, or content that isn't there.
- Reuse the same "only mention what exists" pattern as titles.

## Canonical / hreflang

- Every real, indexable page calls `buildHreflangAlternates()` +
  `buildLocaleUrl()` from `packages/seo` and sets `alternates.canonical` +
  `alternates.languages`. Do this for every new page type — it's a
  three-line addition once `generateMetadata()` exists.
- Known, deliberate gap: the `es` alternate always points at `/es/...`,
  which mostly doesn't exist yet (only the English edition is built). This
  was a conscious earlier tradeoff (declaring the future URL costs nothing
  vs. never declaring one), not an oversight — but it does mean Search
  Console will report hreflang-target-not-found warnings until `/es/*`
  pages actually exist. Don't "fix" this by silently dropping the
  alternate; either build the `/es/` pages or make a deliberate call to
  stop declaring them.

## Indexability / robots

- `apps/web/src/app/robots.ts` disallows `/admin/`. Every `/admin/*` page
  ALSO sets `robots: { index: false, follow: false }` directly (defense in
  depth — `apps/web/src/app/admin/layout.tsx`). Any new admin page
  inherits this from the layout automatically.
- `/search` sets `robots: { index: false, follow: true }` — search-result
  pages are never indexed. Follow this pattern for any future
  parameterized/filtered listing page.
- An article whose retroactive quality-gate check comes back `reject`
  gets `robots: { index: false, follow: false }` instead of being
  unpublished outright (see `apps/web/src/app/articles/[locale]/[slug]/page.tsx`)
  — keeps the URL and its link equity alive without keeping bad content
  indexed.

## Sitemap

- `apps/web/src/app/sitemap.ts` is the single source of truth for what's
  indexable. A new indexable page TYPE (not a new instance of an existing
  type) needs an entry added here. `noindex` pages and `/search` are
  deliberately excluded — don't add them.
- Set `lastModified` from a real timestamp when one exists (a Fact's
  `createdAt`, a Story's `lastUpdatedAt`, an Article's `updatedAt`).
  Omit it entirely rather than guessing — Next's sitemap type treats a
  missing field correctly; don't substitute today's date.

## Structured data (JSON-LD)

- Every real page emits `Organization` + `WebSite` (site-wide, in
  `layout.tsx`) plus its own `BreadcrumbList` (`buildBreadcrumbJsonLd()`
  from `packages/seo`) built from the real pages it's actually nested
  under — never a fabricated index page that doesn't exist.
- Always inject JSON-LD via `safeJsonLdString()` (from `packages/seo`),
  never raw `JSON.stringify()` — it escapes `<` so a value containing
  `</script>` can't break out of the script tag. This matters because
  brand/model names and headlines are real admin/AI-generated strings,
  not hardcoded constants.
- Articles use `buildArticleJsonLd()`. Pass `schemaType: "NewsArticle"`
  ONLY for `ArticleType.NEWS` / `BREAKING_NEWS`. Every other type
  (`GUIDE`, `COMPARISON`, `ANALYSIS`, `EXPLAINER`, `REVIEW`, `MARKET`) is
  evergreen, not news — it gets the default plain `"Article"`. Never
  fabricate `review`, `rating`, `offers`, or `author` fields the source
  data doesn't actually have.

## Internal linking

- Link to a real model/brand/article page whenever the data backing that
  link actually exists (`ArticleCarModel`, `EntityRelation`), never by
  guessing from headline text. See the article page's "Related cars" /
  "Related articles" sections and the car page's "Featured articles" for
  the pattern.
- Anchor text is the real headline or the real brand+model name — never a
  generic "click here" or an artificially keyword-stuffed phrase that
  doesn't match what's actually being linked to.

## Per-page-type checklist for a NEW page type

1. `generateMetadata()`: title (bare string, no site-suffix) + description
   built from real available data, `alternates` via `packages/seo`,
   `robots` if it shouldn't be indexed.
2. One real `<h1>` — the specific, descriptive heading, not a generic
   section label (a generic eyebrow label, if you want one, is a
   secondary heading below the H1, not the H1 itself).
3. `BreadcrumbList` JSON-LD if the page has a real place in the site's
   hierarchy.
4. Add it to `sitemap.ts` if it's indexable.
5. Image `alt` text describing the real subject, never empty unless the
   image is purely decorative.
