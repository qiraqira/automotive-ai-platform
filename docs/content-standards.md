# Content Standards — how every article and edit gets made

This is the practical, house-style companion to `docs/editorial-system.md`
(which describes the automated pipeline's architecture). This file is
about voice, factual discipline, and the concrete checks to run before
anything gets published or edited — written down 2026-09-16 after a full
editorial-depth pass over the site, at the user's own request, so every
future session follows the same bar without re-deriving it.

## Voice

Write like an experienced automotive journalist at a real, independent
outlet — competent, natural, analytical, honest, useful to an actual
buyer. Not a manufacturer's press office, not a spec sheet, not a
generic AI copywriter.

**The one rule that matters most:** never just list a number. Explain
what it means for the person who owns the car.

```
BAD:  The RAV4 has 226 hp; the CR-V has 204 hp.
GOOD: The RAV4 has a power edge on paper, but that mostly shows up
      merging onto a highway or towing a full load — everyday driving
      and fuel economy matter just as much for most owners.
```

Vary sentence length. Use natural transitions. Don't make every
paragraph the same shape or every article follow an identical template.

**Never use these as generic filler** (they're fine as literal, specific
claims — never as scene-setting boilerplate that could paste into any
article about any two cars unchanged):
"in today's rapidly evolving...", "as the automotive industry continues
to evolve", "this changes everything", "the best of both worlds", "a
game changer", "a clear winner", "both offer something for everyone",
"moreover", "furthermore", "in conclusion", "a compelling option", "a
significant step forward", "more than just [X]" used as a vague
intensifier. If a heuristic script flags one of these, read the actual
sentence before touching it — some are legitimate literal usage (see
"more than just the earliest deliveries" in a Tesla suspension story,
which is fine — it means "not only," not marketing filler).

No invented drama. No "revolutionizes the industry." No universal winner
declared without real, stated criteria.

## The approved article shape (2026-09-19, owner sign-off: "вот теперь просто идеально")

This section is the standard to check every comparison article against —
both new ones and rewrites of existing ones. It supersedes the earlier,
more template-driven shape (context → price → efficiency → safety →
"US reader" wrap-up) that most of this project's China-vs-West pieces
were originally written in. Read this before writing or rewriting any
comparison article.

**No spoiler block.** Never render or write a labeled "Verdict," "Our
Recommendation," "Key Takeaways," "Winner," or "Which One Should You
Buy?" section before the body text, and never write body paragraphs that
just restate that block's conclusion in different words. The article
page's `keyTakeaway` field renders as exactly this kind of box (`**Key
takeaway:**` inline before the body) — when rewriting an article, set it
to `null` via `rewrite:article` rather than filling it with a full
spoiler conclusion. Let the real conclusion emerge from the analysis
itself, stated once, at the end.

**Write for the buyer, not for "what can be said about this car."**
Before writing any paragraph, ask what a person about to spend real
money on one of these two cars actually needs to know. Apply
CHARACTERISTIC → WHAT IT CHANGES → WHY IT MATTERS to every spec that
gets real estate — a number alone (battery kWh, horsepower, boot liters)
is never enough on its own.

**Interior, practicality, and driving character are not optional
extras** — they're as central as price and safety, and were the
recurring gap in this project's own China-vs-West batch. For every
comparison, actually source and include (when real data exists):
- Real driving impressions from an actual road test (Autocar, Top Gear,
  What Car, Car and Driver, Edmunds, CarExpert, etc.) — steering,
  ride, body control, noise. Never invented, never generic
  ("responsive and comfortable").
- Rear-seat legroom/headroom and cargo capacity, compared concretely
  (liters/cubic feet), not "spacious" or "practical."
- Interior material quality and cabin design, when a real source
  describes it.

**Market framing is a fact, not the theme.** State plainly, once, which
market(s) each car is actually sold and cross-shopped in — including
when that means one side isn't sold in the reader's home market. Don't
make "car X isn't sold in the US" the throughline of every paragraph;
that was a real, repeated overreach in this project's early China-vs-
West pieces. The article is about the cars, not about the process of
determining where they're sold.

**Prefer same-market pairs going forward.** After a long run of
Chinese-brand-vs-Western-brand-in-a-different-market pieces, mix in more
comparisons where both cars are actually sold and cross-shopped in the
same market as the default for new candidate pairs (see
`memory/comparison-pairs-same-market-preference.md`). Existing
cross-market pieces already published get rewritten in place, not
deleted.

**Structure follows the specific pair, not a fixed template.** A good
default shape is context → real differences → deep analysis (driving
character, interior/practicality) → real-world scenarios → trade-offs →
conclusion that follows from the analysis — but don't force every
section into every article, and don't make two different articles read
like the same fill-in-the-blank shape.

**Imperial is the primary unit for this site's prose, metric only as a
light parenthetical — 2026-09-19, backed by a real check** (AP Style's
own guidance, and Car and Driver's own published BMW X5 figures: 194.2-
194.3 in length, 117.1 in wheelbase — matching this project's own
converted numbers exactly). If a source gives a dimension in mm/cm and
it's used in prose (not a SPEC_TABLE, which stays as sourced per
market), convert it to inches as the primary figure rather than leaving
mm as the lead unit or stacking two units — the reverse of the
non-US-price rule below, but the same underlying logic: lead with the
unit this site's actual reader uses day to day.

**Currency and units — light-touch conversions, 2026-09-19 micro-update
(owner's own ask, scoped down after weighing the clutter risk together):**
- The first time a non-US price appears in prose (£/€/etc.), add an
  approximate USD conversion in parentheses, rounded and prefixed with
  `~` — e.g. `£45,730 (~$61,000)` — using a same-session real exchange
  rate, never a stale or invented one. Do this once per price figure in
  prose; never in the `SPEC_TABLE`, which already has one column per
  market and would just get more cluttered.
- When a mile/inch figure is genuinely load-bearing for the comparison
  in prose (range, rear legroom — not every dimension mentioned), add
  the rounded metric equivalent in parentheses — e.g. `354 miles (570
  km)`, `37.6 inches (96 cm)`. Same rule: prose only, not the spec
  table, and only for the numbers that matter to the comparison being
  made, not mechanically on every figure.
- Never present the converted number as more precise than it is —
  round it, and don't let it read as an independently-sourced fact
  distinct from the real one it's derived from.

**Length comes from real added analysis, not padding.** Longer is
better only when every added paragraph teaches the reader something new
— never from repeating a point in different words, restating specs
already given, or adding scene-setting filler.

## What every comparison article needs to actually answer

Don't force every section into every article — pick what's real and
relevant for that specific pair. But the recurring gap found across the
whole corpus this pass was: strong on powertrain/price/safety, silent
on cabin. Check for these explicitly:

- Cabin/passenger space: real passenger volume, front and rear legroom
  (numbers, not "roomy")
- Cargo: behind-seats and seats-folded cubic feet, plus a frunk if one
  exists
- Ride and noise: sourced from a real road test (Consumer Reports,
  Edmunds, Car and Driver, U.S. News, AutoGuide) — never invented. If no
  real source covers it, leave it out rather than guess.
- AWD/drivetrain philosophy differences (standard vs. optional, system
  design) when it's a real differentiator, not just a spec
- Winter/cold-weather range or economy impact, when relevant and sourced
- Safety category breakdown, not just the headline award (see below)
- Cost of ownership: warranty length, real running-cost math (fuel/
  electricity price × real efficiency, not just the EPA sticker)
- Manual transmission / enthusiast-relevant mechanical differences when
  the segment calls for it (sports coupes, hot hatches)

## Factual accuracy — the hard rules

Never invent a price, spec, safety rating, date, availability claim,
quote, or driving impression. Every load-bearing fact needs a real,
checkable source. If a fact can't be verified, either mark it as
unverified in the text or leave it out — never present a guess as
established fact.

**Generation-year matching is the single most common way this goes
wrong.** A vehicle that's been redesigned has a different structure, and
an old rating does not carry over automatically. Before citing *any*
IIHS/Euro NCAP/NHTSA rating:

1. Fetch the rating body's own page for the exact model year being
   discussed (e.g. `iihs.org/ratings/vehicle/<make>/<model>-4-door-suv/
   2026`), don't trust an aggregator's paraphrase.
2. If that exact-year page 404s or says "not yet tested," the vehicle
   has NOT been rated yet — say so plainly ("results expected fall
   2026"), and if a previous generation's rating exists, only cite it
   as explicitly describing the *older* car, never as if it applies to
   the current one.
3. This already caused one real, live correction this session: a
   published RAV4 vs. CR-V article cited the 2024 RAV4's IIHS result as
   current when the redesigned 2026 RAV4 (a genuinely different car)
   hadn't been tested yet. Caught by chance while researching a
   different article — check this deliberately from now on, don't rely
   on catching it by accident.

**Source hierarchy**, best to worst: the rating body's/manufacturer's
own official page > EPA/fueleconomy.gov direct > a named, reputable
outlet (Consumer Reports, Edmunds, Car and Driver, U.S. News, KBB,
AutoGuide) > a dealer blog or aggregator (usable for spec numbers that
are just restating manufacturer data, not for opinion/comparative
claims) > never a forum post or an unnamed "reviewers say" with no
outlet attached.

When sources genuinely disagree (e.g. two outlets give different mpg
figures), say so rather than silently picking one — or re-verify against
the manufacturer's own page to resolve it.

## Images

Every photo must be a real photograph of the actual real vehicle —
never AI-generated, never a 3D render/CAD mockup passed off as a photo.
Live-tested this directly once: Pollinations.ai producing "Civic and
Mazda3 parked side by side" returned generic, wrong-body-style
silhouettes with no real make/model likeness. Rule stands absolutely:
see `memory/real-photos-never-ai-generated.md`.

Before attaching any photo:
1. Find it on Wikimedia Commons (or another real, licensed source) via
   a real search — never guess a filename.
2. Download and **actually look at it** (the Read tool renders images)
   to confirm it's really the claimed make/model/generation, and that
   it's a genuine photo, not a heavily modified/widebody show car, not
   the wrong sibling model (e.g. Bronco Sport when the article is about
   Bronco), not an interior-only or dashboard-only shot when a HERO
   exterior photo is needed.
3. Self-host it (`selfHostImage()` / `attachCarModelPhoto()` /
   `publish-manual-article.ts`'s `heroImage`/`heroImagePair`) — never
   leave an image hotlinked to a third party. Wikimedia's own thumb
   service rate-limits non-browser traffic; a hotlinked image is a real
   live-site reliability risk, not just a style preference.
4. If no real photo exists for what's needed (found this exactly once,
   for a battery-storage news story), leave the article without a photo
   rather than substitute a render or an unrelated stock image.

## Video

Same "real, never fabricated" bar applies to video as to photos.

- Verify the uploading channel is genuinely the manufacturer's official
  channel before using a video — many "2026 [Model] Official Reveal!"
  titles on YouTube are third-party reaction/rumor channels (confirmed
  this directly: "TheAutoReport", "CAR REVIEW CHANNEL" etc. using
  "Official Reveal" in clickbait titles for cars that were never
  actually revealed by anyone). Check the page's own `"author"` field
  against the real manufacturer channel name.
- Verify the video is for the correct generation of the car being
  discussed — a 2020 reveal video does not represent a redesigned 2026
  model, same trap as the safety-rating issue above.
- **Comparison-article balance, found and fixed 2026-09-16**: if a
  comparison shows an official video for one of the two cars, it must
  show one for the other too — inline (the `VIDEO` article-block type)
  or via the automatic "Compare on video" section (which now only
  renders when *both* linked cars have a curated video — see
  `memory/comparison-article-video-balance.md`). Never one-sided.
- **Real interactive playback, not a plain embed — fixed 2026-09-19,
  owner's own direct catch.** The article page's "Compare on video"
  section used to render a plain `<iframe>` with default YouTube
  chrome. It must use the same `CinematicVideo` component the homepage's
  "Watch" section and the inline `VIDEO` block already use (muted,
  autoplays once scrolled into view, real click-to-unmute) — never a
  bare iframe.
- **Hard cap: one OFFICIAL + one CRASH_TEST video per car, four total
  — 2026-09-19 (owner's own ask).** Crash-test footage is optional, not
  required. Enforced in code (`videosByTextIndex`'s per-category dedupe
  in the same file) — never curate more than one video per category per
  car via `add:car-video` in the first place, since the page will only
  ever show the first one of each category anyway.
- **Two full-width moments, not a side-by-side grid — same-day
  follow-up, owner's own ask.** Each linked car's video renders full
  width on its own, not squeezed into a two-column grid. They're spaced
  through the body the same way gallery photos already are: the first
  car's video lands right after the opening paragraph (by then the
  reader knows why these two cars are being compared), the second car's
  video lands two paragraphs later — never both dropped in the same
  spot. This is implemented in
  `apps/web/src/app/articles/[locale]/[slug]/page.tsx` (the
  `videosByTextIndex` map) — a rewritten article doesn't need to do
  anything special to get this; it's automatic as long as both linked
  `CarModel`s have a curated `OFFICIAL` video attached via
  `add:car-video`.

## Technical workflow (for this specific codebase)

- **New comparison articles**: run `npm run compare:next-candidate
  --workspace @automotive/worker` inside the worker container to find a
  real, not-yet-covered pair with existing catalog data (specs, real
  self-hosted photos already available). Research every fact fresh per
  the rules above, write the piece, build a `ManualArticleSpec` JSON
  (see `publish-manual-article.ts`'s own interface), and publish with
  `npm run publish:manual --workspace @automotive/worker -- <path>`.
  This path takes no AI API call — it's a human/session-written article,
  same as the rest of the hand-authored evergreen content.
- **Editing an existing article's text**: direct SQL against
  `article_blocks`/`citations` (position-shift existing blocks, insert
  new ones, `jsonb_set` for in-place text/spec-table edits) — see any of
  the `*-patch.sql` scripts written this session for the pattern.
  Never delete or renumber blocks carelessly; always re-check the full
  position sequence (`SELECT position, type ... ORDER BY position`) has
  no gaps or duplicates after a patch.
- **Every** DB change and every code change gets verified live via curl
  against the real URL before being considered done — grep for the
  specific new content, not just an HTTP 200.
- Code changes (schema, components, renderer logic) go through the
  normal path: edit → typecheck the affected workspace(s) → commit →
  push → `ssh ... bash infrastructure/scripts/deploy.sh` → verify live.
