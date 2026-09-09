import type { Metadata } from "next";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// spec §67: "Также предусмотреть 'How we use AI' и объяснить пользователю
// роль AI в редакционном процессе." The content below describes what this
// system actually does today, not an aspirational description of the full
// spec — see README.md's status table for the exact current state. Update
// this page whenever that table changes, so it never drifts into
// overpromising (spec §70 "no fake authority" applies to describing the
// system honestly too, not just to individual articles).
// Real gap found and fixed 2026-09-07: real hreflang/canonical (spec
// §22/§30), same fix as the rest of /about/* — see /about/page.tsx's
// fuller comment for why.
// Real, serious gap found and fixed 2026-09-09: this page's own "What AI
// does today"/"does not do" sections still said outright that no article
// had been AI-written and that auto-publish was off — true when this page
// was first written, but stale from the moment the real Writer stage
// (apps/worker/src/write-article.ts) went live and AUTO_PUBLISH turned on
// 2026-09-08 (133 real AI-written, auto-published articles live by the
// time this was caught). This is exactly the drift the file's own top
// comment warns against, on the one page whose entire purpose is telling
// readers the truth about AI's role — found during a full portal review,
// not by anyone reporting it. Rewritten to state plainly what's actually
// true: AI drafts and publishes every article with no per-article human
// gate, there's no independent fact-checking stage yet, and both of those
// are named as real gaps rather than smoothed over.
export const metadata: Metadata = {
  title: "How we use AI",
  description: "An honest account of what AI does and doesn't do in our editorial process.",
  alternates: {
    canonical: buildLocaleUrl(SITE_URL, "en", "/about/how-we-use-ai"),
    languages: Object.fromEntries(
      buildHreflangAlternates(SITE_URL, "/about/how-we-use-ai").map((a) => [a.hreflang, a.href]),
    ),
  },
};

// spec §29: real BreadcrumbList, same reasoning as /about/page.tsx.
const breadcrumbJsonLd = buildBreadcrumbJsonLd([
  { name: "Home", url: SITE_URL },
  { name: "About", url: `${SITE_URL}/about` },
  { name: "How we use AI", url: `${SITE_URL}/about/how-we-use-ai` },
]);

export default function HowWeUseAiPage() {
  return (
    <article style={{ maxWidth: "68ch" }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      <h1 style={{ fontSize: 28, margin: "4px 0 20px" }}>How we use AI</h1>

      <p>
        We build this site to eventually let AI handle a large share of the
        operational work of automotive journalism — monitoring sources,
        clustering related coverage, extracting and checking facts, drafting
        articles, and flagging things that need a human's attention. We think
        readers deserve to know exactly where that stands, not a vague
        assurance either way.
      </p>

      <h2 style={{ fontSize: 18 }}>What AI does today</h2>
      <p>
        AI drafts and publishes every article on this site (Anthropic&rsquo;s
        Claude), writing directly from the headlines and short excerpts of
        the original source coverage it monitors — it never reproduces a
        source&rsquo;s own wording, and it&rsquo;s instructed not to state a
        spec, price, date, or quote beyond what the sources actually say.
        Every published article carries the{" "}
        <strong>AI-written</strong> badge you see at the top of the page,
        with no exceptions. Hero images work the same way as facts: a real,
        freely-licensed photo is used when one can be found; AI only
        generates an illustration when no free photo exists, and never for
        coverage of a crash, injury, or death — that gets a real photo or no
        image at all, deliberately, after we found this was a real risk in
        practice.
      </p>

      <h2 style={{ fontSize: 18 }}>What AI does not do (yet)</h2>
      <p>
        There is no independent research or fact-checking stage yet — AI
        does not go verify a claim beyond what the source reporting already
        says, and does not currently have a human editor reviewing each
        article before it goes live. Both are real, acknowledged gaps
        against the fuller editorial process we&rsquo;re building toward, not
        a hidden shortcut: the guardrails that stand in for that today are
        automated ones set by a human in advance (the source-independence
        and budget checks below, and the never-list further down), not
        per-article human judgment. We call the progression from here{" "}
        <strong>AI Assisted → AI Supervised → AI Autonomous</strong>, and
        publishing without a per-article human gate is closer to the
        Autonomous end of that than the name might suggest — we&rsquo;d
        rather say that plainly than let the label undersell it.
      </p>

      <h2 style={{ fontSize: 18 }}>What we will never do</h2>
      <ul>
        <li>Invent a journalist, a quote, an interview, or a personal test-drive experience.</li>
        <li>Publish a claim without a traceable source.</li>
        <li>Let an AI-authored piece pass as human-written, or vice versa — every article records who (or what) wrote it.</li>
        <li>Give an AI system unconditional publishing rights. Every account — human or AI — operates under the same permission system, and publishing rights are granted deliberately, not by default.</li>
      </ul>

      <h2 style={{ fontSize: 18 }}>If we get something wrong</h2>
      <p>
        We do not silently edit a published article to fix a mistake. See
        our <a href="/about/corrections">corrections policy</a> for how we
        handle that.
      </p>
    </article>
  );
}
