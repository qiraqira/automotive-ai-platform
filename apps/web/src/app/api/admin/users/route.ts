import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "create user" form on
// /admin/users — same zero-client-JS proxy pattern as
// /api/admin/alerts/[id]/resolve, forwarding to the real, newly-added
// POST /v1/users (see apps/api/src/app.ts's "Admin: user management"
// section, added 2026-09-07 to close the MANAGE_USERS gap). A plain HTML
// form posts `application/x-www-form-urlencoded`, so this reads it via
// `formData()` and re-encodes as the JSON body apps/api expects.
export async function POST(req: NextRequest) {
  await requireAdminSession();
  const form = await req.formData();
  const body = {
    email: form.get("email"),
    name: form.get("name"),
    password: form.get("password"),
    roleKey: form.get("roleKey"),
  };

  const apiRes = await adminFetch("/v1/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/users?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/users", req));
}
