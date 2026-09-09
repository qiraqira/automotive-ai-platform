import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Add car model" form on
// /admin/cars — forwards to the real POST /v1/cars. Real gap found and
// fixed 2026-09-07: every real CarModel could only ever come from
// seed.ts, even though this platform's Knowledge Graph is built around
// exactly this entity.
export async function POST(req: NextRequest) {
  await requireAdminSession();
  const form = await req.formData();

  const apiRes = await adminFetch("/v1/cars", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brandSlug: form.get("brandSlug"),
      slug: form.get("slug"),
      name: form.get("name"),
    }),
  });

  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/cars?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/cars", req));
}
