import { requireAdminSession, adminFetch } from "@/lib/admin-auth";

interface SystemAlertRow {
  id: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  source: string;
  message: string;
  resolved: boolean;
  createdAt: string;
}

// spec §55-56 "System Alerts" (docs/security.md "Observability") — the
// real, currently-empty-unless-something-actually-failed feed, not a
// mocked demo list. apps/worker's ingestSource() creates a real WARNING
// alert here on a new crawler failure (see apps/worker/src/ingest.ts).
// Real gap found and fixed 2026-09-07 (same day, later pass): this page
// always fetched `/v1/alerts` with no offset, same shape as the same-day
// GET /v1/stories/GET /v1/audit-log fixes (that endpoint's own
// hardcoded take:100 fixed alongside this one). Only 1 real alert
// exists right now — checked live before writing this, not assumed —
// so this page wasn't actually hiding anything YET, but it's the same
// structural gap and would hit the same wall the moment alerts
// accumulate.
const PAGE_SIZE = 100;

// Real gap found and fixed 2026-09-07, same day, one more pass: the
// "Resolve" button's route handler used to discard its real API
// response and always redirect here as if it succeeded — a real, if
// rare, race (someone else already resolved it, or it no longer exists)
// would silently look like success. Same missing-error-check gap found
// across every other "correction"-style route handler in this app the
// same pass; this page had no error-display wiring at all before now,
// unlike every sibling admin page.
const ERROR_MESSAGES: Record<string, string> = {
  not_found: "That alert no longer exists — refresh the page and try again.",
  unknown_error: "Something went wrong.",
};

export default async function AdminAlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; error?: string }>;
}) {
  const me = await requireAdminSession();
  const { offset: offsetParam, error } = await searchParams;
  const offset = Math.max(0, Number(offsetParam) || 0);
  const alertsRes = await adminFetch(`/v1/alerts?offset=${offset}`);
  const { alerts, hasMore } = (alertsRes.ok ? await alertsRes.json() : { alerts: [], hasMore: false }) as {
    alerts: SystemAlertRow[];
    hasMore: boolean;
  };

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

      {error && (
        <p style={{ color: "#b00020", border: "1px solid #b00020", padding: 8, marginBottom: 16 }}>
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown_error}
        </p>
      )}

      <h2 style={{ fontSize: 16 }}>
        System alerts{" "}
        {alerts.length > 0 && (
          <span className="story-meta">
            (showing {offset + 1}–{offset + alerts.length})
          </span>
        )}
      </h2>
      {alerts.length === 0 && <p>{offset === 0 ? "No alerts — nothing has failed." : "No alerts on this page."}</p>}
      <ul className="story-list">
        {alerts.map((alert) => (
          <li key={alert.id} className="story-item">
            <div className="story-meta">
              <span className="badge">{alert.severity}</span>
              {alert.source} · {new Date(alert.createdAt).toLocaleString()} · {alert.resolved ? "resolved" : "unresolved"}
            </div>
            <strong>{alert.message}</strong>
            {!alert.resolved && (
              <form method="post" action={`/api/admin/alerts/${alert.id}/resolve`} style={{ marginTop: 6 }}>
                <button type="submit">Resolve</button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <nav aria-label="Alerts pagination" style={{ marginTop: 16, fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        {offset > 0 && <a href={`/admin/alerts?offset=${Math.max(0, offset - PAGE_SIZE)}`}>← Newer</a>}
        {offset > 0 && hasMore && " · "}
        {hasMore && <a href={`/admin/alerts?offset=${offset + PAGE_SIZE}`}>Older →</a>}
      </nav>
    </section>
  );
}
