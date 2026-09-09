import { requireAdminSession, adminFetch } from "@/lib/admin-auth";

interface RedirectRow {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_body: "From path and to path must both start with /.",
  from_path_taken: "A redirect from that path already exists.",
  // Real gap found and fixed 2026-09-07: the "Update" form's route
  // handler used to discard its real API response and always redirect
  // here as if the correction succeeded — so the real redirect-cycle
  // guard added to PATCH /v1/redirects/:id earlier the same day
  // (apps/api/src/app.ts) was correctly rejecting a cyclical correction
  // server-side, but the real admin UI showed no error at all. `not_found`
  // covers the same real, if rare, race as every other correction page.
  redirect_cycle: "That would create a redirect loop (it points back to itself, or to a path that redirects back here).",
  not_found: "That redirect no longer exists — refresh the page and try again.",
  unknown_error: "Something went wrong.",
};

// Real gap found and fixed 2026-09-07: every real Redirect row could
// only ever come from `seed.ts` — there was no way for an editor to add
// a new redirect (e.g. after renaming a car's slug) or fix a wrong
// `toPath` without a manual DB write, even though `GET
// /v1/redirects/lookup` + apps/web's proxy.ts have driven real 301s off
// this table since early in this project. Gated on
// `MANAGE_SYSTEM_SETTINGS` server-side (see apps/api/src/app.ts) — no
// dedicated PermissionKey exists for redirects specifically.
export default async function AdminRedirectsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await requireAdminSession();
  const { error } = await searchParams;
  const redirectsRes = await adminFetch("/v1/redirects");
  const { redirects } = (redirectsRes.ok ? await redirectsRes.json() : { redirects: [] }) as {
    redirects: RedirectRow[];
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
        Redirects <span className="story-meta">({redirects.length})</span>
      </h2>
      <ul className="story-list">
        {redirects.map((redirect) => (
          <li key={redirect.id} className="story-item">
            <div className="story-meta">{redirect.fromPath}</div>
            <form
              method="post"
              action={`/api/admin/redirects/${redirect.id}`}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <input
                type="text"
                name="toPath"
                defaultValue={redirect.toPath}
                aria-label={`Destination for ${redirect.fromPath}`}
                style={{ width: 220 }}
              />
              <select name="statusCode" defaultValue={redirect.statusCode} aria-label={`Status code for ${redirect.fromPath}`}>
                <option value={301}>301</option>
                <option value={302}>302</option>
              </select>
              <button type="submit">Update</button>
            </form>
          </li>
        ))}
      </ul>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Add a redirect</h2>
      <form method="post" action="/api/admin/redirects" style={{ display: "grid", gap: 8, maxWidth: 320 }}>
        <label>
          From path
          <input type="text" name="fromPath" placeholder="/old-path" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          To path
          <input type="text" name="toPath" placeholder="/new-path" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Status code
          <select name="statusCode" defaultValue={301} style={{ display: "block", width: "100%" }}>
            <option value={301}>301 (permanent)</option>
            <option value={302}>302 (temporary)</option>
          </select>
        </label>
        <button type="submit">Add redirect</button>
      </form>
    </section>
  );
}
