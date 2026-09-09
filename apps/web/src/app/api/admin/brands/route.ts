import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Add brand" form on
// /admin/cars — forwards to the real POST /v1/brands. Real gap found and
// fixed 2026-09-07: every real Brand could only ever come from seed.ts.
export async function POST(req: NextRequest) {
  await requireAdminSession();
  const form = await req.formData();
  const country = form.get("country");

  const apiRes = await adminFetch("/v1/brands", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug: form.get("slug"),
      name: form.get("name"),
      country: country ? country : undefined,
    }),
  });

  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/cars?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/cars", req));
}
