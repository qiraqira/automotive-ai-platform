import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Add redirect" form on
// /admin/redirects — forwards to the real POST /v1/redirects.
export async function POST(req: NextRequest) {
  await requireAdminSession();
  const form = await req.formData();

  const apiRes = await adminFetch("/v1/redirects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromPath: form.get("fromPath"),
      toPath: form.get("toPath"),
      statusCode: Number(form.get("statusCode")) || undefined,
    }),
  });

  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/redirects?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/redirects", req));
}
