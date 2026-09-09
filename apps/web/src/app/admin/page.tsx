import { requireAdminSession } from "@/lib/admin-auth";
import { getSources, getSourceScoreEvents } from "@/lib/api";

// spec §38 CMS "Dashboard" — MVP scope: real session check + a real
// sources list. The full CMS section list (Stories/Articles/Reviews/
// Brands/Models/...) still waits on those entities having any real
// admin-manageable content — an empty nav item linking to nothing yet
// would be exactly the fake-functionality spec §85 rules out. Audit Logs
// graduated out of that list 2026-09-07 once source-trust-score edits and
// alert resolves gave it real content to show (see /admin/audit-log).
// Real gap found and fixed 2026-09-07: `Source.robotsStatus` ("cached
// robots.txt evaluation") sat unused since the schema scaffold —
// `ingestSource()` now checks it on every cycle; flagged here only when
// it's genuinely "disallowed" (the actionable case), not on every
// "allowed" row, to avoid diluting the one status an editor would act on.
// Second real gap found and fixed 2026-09-07: `PATCH /v1/sources/:id`
// (MANAGE_SOURCES-gated) has existed since early in this project and is
// fully tested, but no UI ever called it — real trust-score/active/
// crawl-interval changes only ever happened via curl or a test client.
// This page now has the missing controls: an Activate/Deactivate button
// and an inline trust-score/crawl-interval correction form per source.
// Third real gap found and fixed 2026-09-07: `SourceScoreEvent` (docs/
// editorial-system.md: how trustScore "moves" over time) sat unused
// since the schema scaffold — the trust-score correction form above now
// writes one on every real change, and each source's real history is
// shown here in a collapsed `<details>` (same pattern as /admin/audit-
// log's before/after), not expanded by default since most sources will
// have zero or one entry.
// Fourth real gap found and fixed 2026-09-07: `PATCH /v1/sources/:id`
// let an editor correct an *existing* source, but nothing ever let one
// add a brand-new one — every real source this project has ever
// ingested came from `seed.ts`. New "Add source" form below, same
// error-surfacing pattern as /admin/redirects.
const SOURCE_TYPES = [
  "RSS",
  "ATOM",
  "OFFICIAL_API",
  "MANUFACTURER_PRESS_ROOM",
  "GOVERNMENT",
  "REGULATORY",
  "FINANCIAL_FILING",
  "NEWS_MEDIA",
  "SOCIAL",
  "OTHER",
];
const SOURCE_TIERS = ["PRIMARY", "WIRE", "SPECIALIST", "REGIONAL", "SOCIAL_LEAD", "UNVERIFIED"];

const ERROR_MESSAGES: Record<string, string> = {
  invalid_body: "Check the required fields — name, URL, and type are all required.",
  url_taken: "A source with that URL already exists.",
  // Real gap found and fixed 2026-09-07: the source-correction route
  // handler used to discard its real API response and always redirect
  // here as if it succeeded — `not_found` covers the real, if rare, race
  // where the source being corrected no longer exists by the time the
  // form submits.
  not_found: "That source no longer exists — refresh the page and try again.",
  unknown_error: "Something went wrong.",
};

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await requireAdminSession();
  const { error } = await searchParams;
  const { sources } = await getSources();
  // Real gap found and fixed 2026-09-08, same shape as apps/web's
  // homepage/admin-cars fixes: Promise.all meant a single source's
  // score-history fetch failing (a real, plausible transient issue)
  // crashed this entire dashboard — the FIRST page every admin session
  // lands on, unlike the two already-fixed cases. Unlike those two,
  // `scoreEvents[i]` is read by INDEX against `sources[i]` below (not
  // filtered), so a failure here substitutes a safe empty-events
  // fallback at that index rather than being dropped — dropping would
  // desync every source after it from its own score history.
  const scoreEventResults = await Promise.allSettled(sources.map((s) => getSourceScoreEvents(s.id)));
  const scoreEvents = scoreEventResults.map((result) => {
    if (result.status === "rejected") {
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "admin_dashboard_score_events_failed", reason: String(result.reason) }));
      return { events: [] };
    }
    return result.value;
  });

  return (
    <section>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Admin</h1>
      <div className="story-meta">
        Logged in as {me.name} ({me.email}) — role{me.roles.length === 1 ? "" : "s"}: {me.roles.join(", ")}{" "}
        <form method="post" action="/api/admin/logout" style={{ display: "inline" }}>
          <button type="submit" style={{ font: "inherit", padding: 0, border: 0, background: "none", cursor: "pointer", textDecoration: "underline" }}>
            Log out
          </button>
        </form>
      </div>
      <nav style={{ margin: "12px 0 24px", fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        <a href="/admin">Sources</a> · <a href="/admin/stories">Stories</a> · <a href="/admin/alerts">Alerts</a> ·{" "}
        <a href="/admin/audit-log">Audit log</a> · <a href="/admin/users">Users</a> · <a href="/admin/cars">Cars</a> ·{" "}
        <a href="/admin/redirects">Redirects</a> · <a href="/admin/analytics">Analytics</a> · <a href="/admin/articles">Articles</a>
      </nav>

      {error && (
        <p style={{ color: "#b00020", border: "1px solid #b00020", padding: 8, marginBottom: 16 }}>
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown_error}
        </p>
      )}

      <h2 style={{ fontSize: 16 }}>Sources</h2>
      <ul className="story-list">
        {sources.map((source, i) => (
          <li key={source.id} className="story-item">
            <div className="story-meta">
              {source.tier} · trust {source.trustScore}/100 · {source.active ? "active" : "inactive"}
              {source.lastError ? ` · last error: ${source.lastError}` : ""}
              {source.robotsStatus === "disallowed" ? " · robots.txt: disallowed" : ""}
            </div>
            <strong>{source.name}</strong>

            <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
              <form method="post" action={`/api/admin/sources/${source.id}`}>
                <input type="hidden" name="active" value={(!source.active).toString()} />
                <button type="submit">{source.active ? "Deactivate" : "Activate"}</button>
              </form>

              <form
                method="post"
                action={`/api/admin/sources/${source.id}`}
                style={{ display: "flex", gap: 8, alignItems: "center" }}
              >
                <label>
                  Trust{" "}
                  <input
                    type="number"
                    name="trustScore"
                    defaultValue={source.trustScore}
                    min={0}
                    max={100}
                    style={{ width: 60 }}
                  />
                </label>
                <label>
                  Crawl interval (s){" "}
                  <input
                    type="number"
                    name="crawlInterval"
                    defaultValue={source.crawlInterval}
                    min={60}
                    style={{ width: 80 }}
                  />
                </label>
                <button type="submit">Update</button>
              </form>
            </div>

            <details style={{ marginTop: 8 }}>
              <summary>score history ({scoreEvents[i].events.length})</summary>
              {scoreEvents[i].events.length === 0 ? (
                <p className="story-meta">No trust-score changes recorded yet.</p>
              ) : (
                <ul className="story-list">
                  {scoreEvents[i].events.map((event) => (
                    <li key={event.id} className="story-item">
                      <div className="story-meta">
                        {new Date(event.createdAt).toISOString()} · {event.delta > 0 ? "+" : ""}
                        {event.delta} → {event.newScore}
                      </div>
                      {event.reason}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </li>
        ))}
      </ul>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Add source</h2>
      <form method="post" action="/api/admin/sources" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" name="name" placeholder="name" aria-label="New source name" required style={{ width: 160 }} />
        <input type="text" name="url" placeholder="https://example.com" aria-label="New source URL" required style={{ width: 200 }} />
        <input
          type="text"
          name="feedUrl"
          placeholder="feed URL (optional)"
          aria-label="New source feed URL"
          style={{ width: 200 }}
        />
        <select name="type" aria-label="New source type" required defaultValue="">
          <option value="" disabled>
            type
          </option>
          {SOURCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <select name="tier" aria-label="New source tier" defaultValue="">
          <option value="">tier (default: UNVERIFIED)</option>
          {SOURCE_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </select>
        <button type="submit">Add source</button>
      </form>
    </section>
  );
}
