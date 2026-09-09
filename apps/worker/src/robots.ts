// Real gap found and fixed 2026-09-07: `Source.robotsStatus` ("cached
// robots.txt evaluation") has sat unused since the initial schema
// scaffold — this crawler has fetched all 3 real seeded feeds every
// `crawlInterval` since day one without ever checking whether the
// source's robots.txt actually permits it. Verified live against all 3
// real robots.txt files before writing this: none currently disallow
// the specific feed paths being crawled (electrek.co's `/feed/`,
// insideevs.com/motor1.com's `/rss/articles/all/`) — so this closes a
// real compliance gap that happens to be a no-op today, not a
// hypothetical one. A source could add a feed-path restriction in the
// future, or a newly-added source might have one from day one; this is
// the check that would actually catch it.

interface RobotsRule {
  disallow: boolean;
  path: string;
}

// Real gap found and fixed 2026-09-07, same day as the rest of this
// file: `matchesRobotsPattern()` below didn't exist — path matching was
// a plain `path.startsWith(rule.path)`, treating `*`/`$` as literal
// characters instead of the real robots.txt extended-pattern syntax
// (RFC 9309 §2.2.3: `*` matches any sequence of characters, a trailing
// `$` anchors the match to the end of the path). Not hypothetical:
// electrek.co's own real robots.txt (fetched live to verify this,
// same discipline as this file's original gap above) already has
// `Disallow: /*?s=` / `/*&s=` / `/*ep_filter_` — real wildcard rules in
// active use by one of this crawler's exact 3 real sources today. They
// happen not to match `/feed/` (the path actually being crawled), so
// the plain-prefix version computed the right answer by coincidence,
// not because wildcards were actually understood — the moment any real
// source's Disallow rule used a wildcard that DID cover a crawled path,
// this would have silently kept crawling a real, explicit
// disallow — an actual compliance violation, not a near-miss.
function matchesRobotsPattern(path: string, pattern: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regexSource = body
    .split("*")
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regexSource}${anchored ? "$" : ""}`).test(path);
}

/** Minimal robots.txt parser covering User-agent/Disallow/Allow — the
 * only directives this crawler's own compliance check needs (Crawl-delay,
 * Sitemap, etc. are irrelevant here). Picks the most specific matching
 * `User-agent` group (this bot's own UA if the file names it, else `*`),
 * per the standard robots.txt convention, then applies the longest
 * matching rule (also standard — a longer, more specific path wins over
 * a shorter, more general one regardless of Allow/Disallow order; rule
 * length is measured on the pattern as declared, wildcards and all —
 * same as real crawlers, per RFC 9309 §2.2.2). */
export function isPathAllowed(robotsTxt: string, userAgent: string, path: string): boolean {
  const groups = new Map<string, RobotsRule[]>();
  let currentAgents: string[] = [];
  let sawRuleSinceLastAgent = false;

  for (const rawLine of robotsTxt.split("\n")) {
    const line = rawLine.split("#")[0]!.trim();
    if (!line) continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const field = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (field === "user-agent") {
      const agent = value.toLowerCase();
      // Per the robots.txt convention: consecutive User-agent lines share
      // one group ("User-agent: A" / "User-agent: B" / shared rules), but
      // a User-agent line seen *after* this group already has rules
      // starts a brand new group instead of extending this one.
      if (sawRuleSinceLastAgent) {
        currentAgents = [];
        sawRuleSinceLastAgent = false;
      }
      currentAgents.push(agent);
      if (!groups.has(agent)) groups.set(agent, []);
    } else if (field === "disallow" || field === "allow") {
      for (const agent of currentAgents) {
        groups.get(agent)!.push({ disallow: field === "disallow", path: value });
      }
      sawRuleSinceLastAgent = true;
    }
  }

  const ourAgent = userAgent.toLowerCase();
  const applicableGroup =
    [...groups.keys()].find((agent) => agent !== "*" && ourAgent.includes(agent)) ?? (groups.has("*") ? "*" : null);
  if (!applicableGroup) return true; // no matching group at all — nothing restricts us

  const rules = groups.get(applicableGroup)!;
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (rule.path === "") continue; // an empty Disallow means "allow everything" — no path to match
    if (matchesRobotsPattern(path, rule.path) && (!best || rule.path.length > best.path.length)) {
      best = rule;
    }
  }
  return best ? !best.disallow : true;
}

// Real gap found and fixed 2026-09-07: same reasoning as ingest.ts's own
// FEED_FETCH_TIMEOUT_MS — without a timeout, a hanging robots.txt server
// would block indefinitely rather than hitting the catch block below.
// That directly contradicts this function's own documented promise
// ("never blocks on network trouble reaching robots.txt itself") — a
// hang IS network trouble, it just wasn't failing fast before. Shorter
// than the feed timeout since this is a small, usually-cached-by-the-
// origin-server text file, not real feed content.
const ROBOTS_FETCH_TIMEOUT_MS = 10_000;

/** Fetches and evaluates `{origin}/robots.txt` for `feedUrl`. A missing
 * or unfetchable robots.txt means "everything allowed" per the robots.txt
 * convention (most real sites don't publish one at all) — this only ever
 * blocks on an explicit Disallow, never on network trouble reaching the
 * robots.txt itself (that's a separate, already-handled failure mode:
 * the feed fetch that follows will surface its own real error). */
export async function checkRobotsAllowed(feedUrl: string, userAgent: string): Promise<boolean> {
  try {
    // Real gap found and fixed 2026-09-07: `new URL(feedUrl)` used to sit
    // outside this try block — a malformed `feedUrl` (nothing validates
    // its format before it reaches here; see the real fix on
    // createSourceSchema/updateSourceSchema in apps/api/src/app.ts) threw
    // synchronously, which an async function turns into a REJECTED
    // promise, not a caught one — directly contradicting this function's
    // own documented contract ("never blocks on network trouble reaching
    // robots.txt itself"). Verified live before fixing: an uncaught
    // rejection here propagates all the way out of `ingestSource()`,
    // skipping the graceful WARNING-SystemAlert path a normal feed-fetch
    // failure gets, and instead wastes 2 real BullMQ retry attempts
    // hitting the same permanently-invalid URL before the job exhausts
    // retries. Moved inside the try so a malformed URL now degrades the
    // same documented way any other robots.txt-reachability trouble does.
    const url = new URL(feedUrl);
    const res = await fetch(`${url.protocol}//${url.host}/robots.txt`, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(ROBOTS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return true;
    return isPathAllowed(await res.text(), userAgent, url.pathname);
  } catch {
    return true;
  }
}
