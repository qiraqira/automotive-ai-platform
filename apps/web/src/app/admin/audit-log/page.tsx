import { requireAdminSession, adminFetch } from "@/lib/admin-auth";

interface AuditLogEntry {
  id: string;
  actorType: "HUMAN" | "AI" | "SYSTEM";
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  before: unknown;
  after: unknown;
}

// Real gap found and fixed 2026-09-07: `PermissionKey.VIEW_AUDIT_LOG`
// already existed and was granted to every admin, and real mutations
// (`PATCH /v1/sources/:id`, `PATCH /v1/alerts/:id/resolve`) already wrote
// real AuditLog rows — but nothing could ever read them back. This is
// that missing read-only view, same pattern as the `/admin/page.tsx`
// comment that used to (correctly) call "Audit Logs" not-yet-real.
// Second real gap found and fixed 2026-09-07 (same day, later pass):
// this page always fetched `/v1/audit-log` with no offset, and that
// endpoint had a hardcoded take:100 — checked live before writing this
// fix: this dev DB already has 1,500+ real AuditLog rows (every one of
// today's own admin mutations wrote one), meaning this page had already
// been silently hiding 1,400+ real historical entries for a page whose
// entire purpose is being the audit trail. Real "Newer"/"Older" links
// below, same offset-pagination pattern as /admin/stories.
const PAGE_SIZE = 100;

export default async function AdminAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const me = await requireAdminSession();
  const { offset: offsetParam } = await searchParams;
  const offset = Math.max(0, Number(offsetParam) || 0);
  const entriesRes = await adminFetch(`/v1/audit-log?offset=${offset}`);
  const { entries, hasMore } = (entriesRes.ok ? await entriesRes.json() : { entries: [], hasMore: false }) as {
    entries: AuditLogEntry[];
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

      <h2 style={{ fontSize: 16 }}>
        Audit log{" "}
        {entries.length > 0 && (
          <span className="story-meta">
            (showing {offset + 1}–{offset + entries.length})
          </span>
        )}
      </h2>
      {entries.length === 0 && <p>{offset === 0 ? "No audit log entries yet." : "No entries on this page."}</p>}
      <ul className="story-list">
        {entries.map((entry) => (
          <li key={entry.id} className="story-item">
            <div className="story-meta">
              {entry.actorLabel} ({entry.actorType}) · {new Date(entry.createdAt).toLocaleString()}
            </div>
            <strong>
              {entry.action} — {entry.entityType} {entry.entityId}
            </strong>
            <details style={{ marginTop: 4 }}>
              <summary>before / after</summary>
              <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ul>

      <nav aria-label="Audit log pagination" style={{ marginTop: 16, fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        {offset > 0 && (
          <a href={`/admin/audit-log?offset=${Math.max(0, offset - PAGE_SIZE)}`}>← Newer</a>
        )}
        {offset > 0 && hasMore && " · "}
        {hasMore && <a href={`/admin/audit-log?offset=${offset + PAGE_SIZE}`}>Older →</a>}
      </nav>
    </section>
  );
}
