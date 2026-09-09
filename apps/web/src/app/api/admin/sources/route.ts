import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Add source" form on /admin —
// forwards to the real POST /v1/sources. Real gap found and fixed
// 2026-09-07: every real source could only ever come from seed.ts, even
// though this whole ingestion pipeline is built around Source rows.
export async function POST(req: NextRequest) {
  await requireAdminSession();
  const form = await req.formData();
  const feedUrl = form.get("feedUrl");
  const tier = form.get("tier");

  const apiRes = await adminFetch("/v1/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: form.get("name"),
      url: form.get("url"),
      feedUrl: feedUrl ? feedUrl : undefined,
      type: form.get("type"),
      tier: tier ? tier : undefined,
    }),
  });

  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin", req));
}
