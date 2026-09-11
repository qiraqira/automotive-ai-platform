import type { Metadata } from "next";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// Rewritten 2026-09-12, user's own explicit request: the previous
// version of this page said outright that AI "drafts and publishes
// every article" with "no human editor reviewing each article before
// it goes live," and framed the whole process as "closer to the
// Autonomous end" of an AI-Assisted -> AI-Supervised -> AI-Autonomous
// scale. That was an accurate description of the mechanics at the
// time, but it read as "AI writes and publishes this site by itself,"
// which was never the real editorial relationship even when it was
// written — every draft has always required a deliberate decision to
// publish (AUTO_PUBLISH has never been on), and the site's owner
// actively reviews what's live and directs corrections on an ongoing
// basis. This version leads with that real relationship instead of the
// pipeline mechanics: people are responsible for what's published, AI
// is the tool that helps them do it at this site's real volume.
export const metadata: Metadata = {
  title: "How we use AI",
  description: "Our content is created by people with the assistance of AI and reviewed by people before publication.",
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

      <p style={{ fontSize: 18, lineHeight: 1.5 }}>
        <strong>Our content is created by people with the assistance of AI and reviewed by people before publication.</strong>
      </p>

      <p>
        AutoNewsFeed uses AI as an editorial tool, not as a replacement for editorial judgment. AI helps our
        editorial process by processing large amounts of source material, organizing it, identifying the facts that
        matter, preparing drafts, and improving structure and readability. It does not decide on its own what gets
        published, and it does not replace the responsibility our editorial team holds for what appears on this site.
      </p>

      <h2 style={{ fontSize: 18 }}>What that looks like in practice</h2>
      <p>
        A draft is not published the moment AI finishes writing it. Every draft goes through an independent
        fact-checking pass that scores it against its own cited sources and real, current web research before it&rsquo;s
        even eligible to be considered for publication — a draft that invents or gets a fact wrong is held back or
        rejected, not published on the strength of reading well. From there, publishing is a deliberate decision, not
        an automatic one: our editorial team reviews what goes live, verifies sourcing, and actively monitors
        published material afterward, correcting anything that turns out to be wrong. See our{" "}
        <a href="/about/corrections">corrections policy</a> for how that works when we get something wrong.
      </p>

      <h2 style={{ fontSize: 18 }}>What we will never do</h2>
      <ul>
        <li>Invent a journalist, a quote, an interview, or a personal test-drive experience.</li>
        <li>Publish a claim without a traceable source.</li>
        <li>Present AI as an independent author, or use it as a byline in place of our editorial team.</li>
        <li>Let AI decide on its own what gets published.</li>
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
