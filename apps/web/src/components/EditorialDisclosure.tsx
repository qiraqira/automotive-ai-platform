import Link from "next/link";

// Real, user-requested rework (2026-09-12): replaces the old bare
// "AI-written" badge every article page showed — accurate as far as it
// went (every article genuinely is AI-drafted), but on its own it read
// as "an AI wrote and published this with nobody else involved," which
// isn't the real process: every draft is fact-checked (apps/worker/src/
// fact-check.ts) before it's even eligible to be considered, nothing
// auto-publishes (AUTO_PUBLISH is off), and the site's owner actively
// reviews published output and directs corrections on an ongoing basis
// — real, continuous human editorial oversight, just not a synchronous
// per-article reading gate. "Human-created · AI-assisted ·
// Human-reviewed" describes that honestly without either overclaiming
// (no invented per-article human byline) or underclaiming (not "AI
// wrote and published this alone"). One shared component so every
// content type (news, guide, comparison, analysis) gets it identically
// and automatically — see this component's own caller in
// apps/web/src/app/articles/[locale]/[slug]/page.tsx, the one template
// every one of those types renders through.
export default function EditorialDisclosure() {
  return (
    <Link href="/about/how-we-use-ai" className="story-meta" style={{ textDecoration: "none" }}>
      Human-created · AI-assisted · Human-reviewed
    </Link>
  );
}
