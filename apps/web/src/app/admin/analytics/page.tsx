import { requireAdminSession, adminFetch } from "@/lib/admin-auth";

interface PageviewRow {
  path: string;
  count: number;
}

interface SearchQueryRow {
  id: string;
  query: string;
  locale: string;
  resultsCount: number;
  createdAt: string;
}

// Real gap found and fixed 2026-09-07: `apps/web`'s proxy.ts has written
// a real AnalyticsEvent on every pageview, and `GET /v1/search` has
// written a real SearchQuery row (with its actual result count) on every
// search, since each of those features shipped — 1500+ and 300+ real
// rows in this dev DB. Both were exactly as write-only as AuditLog used
// to be. This is the read-only view: real top pages, and real recent
// searches with zero-result ones visually flagged — the actionable
// editorial signal here is a reader searching for something the site
// doesn't have yet.
// Second real gap found and fixed 2026-09-07 (same day, later pass):
// "Recent searches" always called `/v1/search-queries` with no offset,
// and that endpoint had a hardcoded take:50 — checked live and found
// 722 real rows already in this dev DB, so 672 real searches (including
// any older zero-result ones) were permanently unreachable. Same
// offset/hasMore pattern as Stories/Alerts/Audit-log.
const PAGE_SIZE = 50;

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const me = await requireAdminSession();
  const { offset: offsetParam } = await searchParams;
  const offset = Math.max(0, Number(offsetParam) || 0);
  // Real gap found and fixed 2026-09-08: this already tolerates either
  // call returning a non-ok HTTP status (the `.ok ? ... : fallback` below
  // predates this fix) — the one gap was a genuine network-level failure
  // (adminFetch's own AbortSignal.timeout firing, a real, plausible
  // transient issue, same as the homepage/admin-cars/admin-dashboard
  // fixes) rejecting the Promise itself rather than resolving with a
  // non-ok Response, which Promise.all would have let crash this whole
  // page despite the author's already-demonstrated intent (the fallback
  // objects below) to treat these two calls as independently degradable.
  const [pageviewsResult, queriesResult] = await Promise.allSettled([
    adminFetch("/v1/analytics/pageviews"),
    adminFetch(`/v1/search-queries?offset=${offset}`),
  ]);
  if (pageviewsResult.status === "rejected") {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "admin_analytics_pageviews_failed", reason: String(pageviewsResult.reason) }));
  }
  if (queriesResult.status === "rejected") {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "admin_analytics_queries_failed", reason: String(queriesResult.reason) }));
  }
  const { pageviews } = (pageviewsResult.status === "fulfilled" && pageviewsResult.value.ok
    ? await pageviewsResult.value.json()
    : { pageviews: [] }) as { pageviews: PageviewRow[] };
  const { queries, hasMore } = (queriesResult.status === "fulfilled" && queriesResult.value.ok
    ? await queriesResult.value.json()
    : { queries: [], hasMore: false }) as { queries: SearchQueryRow[]; hasMore: boolean };

  return (
    <section>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Admin</h1>
      <div className="story-meta">
        Logged in as {me.name}{" "}
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

      <h2 style={{ fontSize: 16 }}>
        Top pages <span className="story-meta">({pageviews.length})</span>
      </h2>
      {pageviews.length === 0 && <p>No pageviews recorded yet.</p>}
      <ul className="story-list">
        {pageviews.map((row) => (
          <li key={row.path} className="story-item">
            <strong>{row.path}</strong> <span className="story-meta">— {row.count} views</span>
          </li>
        ))}
      </ul>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>
        Recent searches{" "}
        {queries.length > 0 && (
          <span className="story-meta">
            (showing {offset + 1}–{offset + queries.length})
          </span>
        )}
      </h2>
      {queries.length === 0 && <p>{offset === 0 ? "No searches logged yet." : "No searches on this page."}</p>}
      <ul className="story-list">
        {queries.map((q) => (
          <li key={q.id} className="story-item">
            <div className="story-meta">
              {q.locale} · {new Date(q.createdAt).toLocaleString()}
            </div>
            <strong>{q.query}</strong>{" "}
            {q.resultsCount === 0 ? (
              <span className="badge" style={{ background: "#b00020", color: "#fff" }}>
                0 results
              </span>
            ) : (
              <span className="story-meta">{q.resultsCount} results</span>
            )}
          </li>
        ))}
      </ul>

      <nav aria-label="Recent searches pagination" style={{ marginTop: 16, fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        {offset > 0 && <a href={`/admin/analytics?offset=${Math.max(0, offset - PAGE_SIZE)}`}>← Newer</a>}
        {offset > 0 && hasMore && " · "}
        {hasMore && <a href={`/admin/analytics?offset=${offset + PAGE_SIZE}`}>Older →</a>}
      </nav>
    </section>
  );
}
