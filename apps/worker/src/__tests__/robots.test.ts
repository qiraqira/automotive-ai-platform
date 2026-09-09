import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRobotsAllowed, isPathAllowed } from "../robots.js";

const USER_AGENT = "Mozilla/5.0 (compatible; AutomotivePlatformBot/0.1)";

describe("isPathAllowed", () => {
  it("allows everything when robots.txt has no matching group at all", () => {
    expect(isPathAllowed("User-agent: SomeOtherBot\nDisallow: /", USER_AGENT, "/feed/")).toBe(true);
  });

  it("allows a path an empty Disallow under * doesn't restrict — the real electrek.co shape", () => {
    // Reproduces electrek.co's real robots.txt (fetched live 2026-09-07):
    // a Yoast-generated "User-agent: *\nDisallow:\n" block (empty
    // Disallow = allow everything) alongside a search-facet block that
    // doesn't touch /feed/.
    const robotsTxt = `
User-agent: *
Disallow:

User-agent: *
Disallow: /*?s=
Disallow: /*&s=
`;
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed/")).toBe(true);
  });

  it("disallows a path explicitly blocked for *", () => {
    const robotsTxt = "User-agent: *\nDisallow: /private/\n";
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/private/feed.xml")).toBe(false);
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed/")).toBe(true);
  });

  it("prefers this bot's own named group over a wildcard group when both exist", () => {
    const robotsTxt = "User-agent: *\nDisallow: /feed/\n\nUser-agent: AutomotivePlatformBot\nDisallow:\n";
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed/")).toBe(true);
  });

  it("applies the longest matching rule, not just the first — Allow overriding a broader Disallow", () => {
    const robotsTxt = "User-agent: *\nDisallow: /feed\nAllow: /feed/public/\n";
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed/private/")).toBe(false);
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed/public/")).toBe(true);
  });

  it("shares one group across consecutive User-agent lines", () => {
    const robotsTxt = "User-agent: BotA\nUser-agent: BotB\nDisallow: /x/\n";
    expect(isPathAllowed(robotsTxt, "BotB", "/x/y")).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const robotsTxt = "# a comment\n\nUser-agent: *\n# another comment\nDisallow: /blocked/ # inline comment\n";
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/blocked/x")).toBe(false);
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/ok/")).toBe(true);
  });

  // Real gap found and fixed 2026-09-07 (same day, later pass): path
  // matching used to be a plain `path.startsWith(rule.path)`, treating
  // `*`/`$` as literal characters instead of real robots.txt wildcard
  // syntax (RFC 9309 §2.2.3). These use electrek.co's own real
  // `Disallow: /*?s=` rule (fetched live to confirm) — proving the fix
  // against genuine data, not a synthetic pattern.
  it("honors a real wildcard Disallow rule (electrek.co's own /*?s= search-facet block)", () => {
    const robotsTxt = "User-agent: *\nDisallow: /*?s=\nDisallow: /*&s=\n";
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/?s=recall")).toBe(false);
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed/?s=recall")).toBe(false);
    // The real crawled path itself must stay allowed — no `?s=` in it.
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed/")).toBe(true);
  });

  it("honors a trailing $ end-anchor, distinguishing it from an unanchored prefix match", () => {
    const robotsTxt = "User-agent: *\nDisallow: /feed$\n";
    // Anchored: matches the exact path, not everything starting with it.
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed")).toBe(false);
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed/")).toBe(true);
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed/all.xml")).toBe(true);
  });

  it("still treats a plain literal path as a prefix match — no regression for the common, wildcard-free case", () => {
    const robotsTxt = "User-agent: *\nDisallow: /private/\n";
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/private/feed.xml")).toBe(false);
    expect(isPathAllowed(robotsTxt, USER_AGENT, "/feed/")).toBe(true);
  });
});

describe("checkRobotsAllowed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Real gap found and fixed 2026-09-07: this fetch had no timeout at
  // all — a hanging robots.txt server would block indefinitely instead
  // of hitting this function's own documented fail-open behavior.
  // Rather than actually waiting out a real timeout in a test (slow,
  // and AbortSignal.timeout()'s internal timer isn't reliably
  // interceptable by vitest's fake timers), this proves the fix
  // structurally: the real fetch call now genuinely carries an
  // AbortSignal.
  it("passes a real AbortSignal to fetch, so a hang can actually be aborted", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    await checkRobotsAllowed("https://example.test/feed.xml", USER_AGENT);
    expect(spy).toHaveBeenCalledWith(
      "https://example.test/robots.txt",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("fails open (allowed) when the fetch rejects with a timeout-shaped error, same as any other network failure", async () => {
    const timeoutError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    vi.spyOn(global, "fetch").mockRejectedValue(timeoutError);
    const allowed = await checkRobotsAllowed("https://example.test/feed.xml", USER_AGENT);
    expect(allowed).toBe(true);
  });

  // Real gap found and fixed 2026-09-07: `new URL(feedUrl)` used to sit
  // outside this function's try block — a malformed feedUrl threw
  // synchronously, which an async function turns into a REJECTED
  // promise rather than a caught one, directly contradicting this
  // function's own documented "never blocks on network trouble" fail-
  // open contract. Real risk: nothing validated a Source's feedUrl
  // format before this fix (see the real fix on createSourceSchema,
  // apps/api/src/app.ts), so a malformed one reaching here would have
  // wasted real BullMQ retry attempts on a URL that can never succeed.
  it("fails open (allowed) for a malformed feedUrl, instead of an uncaught rejection", async () => {
    const spy = vi.spyOn(global, "fetch");
    const allowed = await checkRobotsAllowed("not-a-real-url", USER_AGENT);
    expect(allowed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
