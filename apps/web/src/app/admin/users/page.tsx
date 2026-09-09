import { requireAdminSession, adminFetch } from "@/lib/admin-auth";

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED" | "INVITED";
  roles: string[];
}

interface RoleRow {
  key: string;
  name: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_body: "Please fill in a valid email, name, and an at-least-8-character password.",
  unknown_role: "That role doesn't exist.",
  email_taken: "A user with that email already exists.",
  cannot_suspend_self: "You can't suspend your own account.",
  // Real gap found and fixed 2026-09-07: PATCH /v1/users/:id/status can
  // genuinely 404 (the real, if rare, race where the user being
  // suspended/activated was already deleted by someone else) — this map
  // was missing that case, same as every other admin page's
  // ERROR_MESSAGES fixed the same day.
  not_found: "That user no longer exists — refresh the page and try again.",
  unknown_error: "Something went wrong.",
};

// Real gap found and fixed 2026-09-07: `PermissionKey.MANAGE_USERS`
// already existed and every admin already had it granted, but no
// endpoint or page ever used it — seed.ts's single hardcoded admin was
// the only User row that could ever exist. This is the read-write admin
// view: real user creation (hashed passwords, a real role assignment)
// and real activate/suspend, both writing real AuditLog rows (see
// /admin/audit-log). Same zero-client-JS `<form>` pattern as the
// "Resolve" button on /admin/alerts.
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await requireAdminSession();
  const { error } = await searchParams;

  // Real gap found and fixed 2026-09-08, same shape/reasoning as
  // /admin/analytics's own identical fix: a genuine network-level
  // failure (adminFetch's own AbortSignal.timeout firing) on either call
  // would reject the Promise itself, which Promise.all let crash this
  // whole page despite the `.ok ? ... : fallback` below already showing
  // the intent to treat both calls as independently degradable.
  const [usersResult, rolesResult] = await Promise.allSettled([adminFetch("/v1/users"), adminFetch("/v1/roles")]);
  if (usersResult.status === "rejected") {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "admin_users_list_failed", reason: String(usersResult.reason) }));
  }
  if (rolesResult.status === "rejected") {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "admin_users_roles_failed", reason: String(rolesResult.reason) }));
  }
  const { users } = (usersResult.status === "fulfilled" && usersResult.value.ok
    ? await usersResult.value.json()
    : { users: [] }) as { users: UserRow[] };
  const { roles } = (rolesResult.status === "fulfilled" && rolesResult.value.ok
    ? await rolesResult.value.json()
    : { roles: [] }) as { roles: RoleRow[] };

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
        Users <span className="story-meta">({users.length})</span>
      </h2>
      <ul className="story-list">
        {users.map((user) => (
          <li key={user.id} className="story-item">
            <div className="story-meta">
              {user.email} · {user.roles.join(", ") || "no role"} · {user.status}
            </div>
            <strong>{user.name}</strong>
            {user.id !== me.id && user.status !== "SUSPENDED" && (
              <form method="post" action={`/api/admin/users/${user.id}/status`} style={{ marginTop: 6 }}>
                <input type="hidden" name="status" value="SUSPENDED" />
                <button type="submit">Suspend</button>
              </form>
            )}
            {user.status === "SUSPENDED" && (
              <form method="post" action={`/api/admin/users/${user.id}/status`} style={{ marginTop: 6 }}>
                <input type="hidden" name="status" value="ACTIVE" />
                <button type="submit">Activate</button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Add a user</h2>
      <form method="post" action="/api/admin/users" style={{ display: "grid", gap: 8, maxWidth: 320 }}>
        <label>
          Email
          <input type="email" name="email" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Name
          <input type="text" name="name" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Password
          <input type="password" name="password" required minLength={8} style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Role
          <select name="roleKey" required style={{ display: "block", width: "100%" }}>
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Create user</button>
      </form>
    </section>
  );
}
