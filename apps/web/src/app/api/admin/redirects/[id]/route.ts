import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the per-redirect "Update" button
// on /admin/redirects — forwards to the real PATCH /v1/redirects/:id.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  const form = await req.formData();

  const apiRes = await adminFetch(`/v1/redirects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toPath: form.get("toPath"),
      statusCode: Number(form.get("statusCode")) || undefined,
    }),
  });

  // Real gap found and fixed 2026-09-07: this discarded the real API
  // response entirely and always redirected as if the update succeeded
  // — so the real redirect-cycle guard added to PATCH /v1/redirects/:id
  // earlier the same day (apps/api/src/app.ts) correctly rejected a
  // cyclical correction server-side, but an admin using this actual
  // page would see no error at all, just a silent no-op with the old
  // value still showing. Same missing-error-check gap found across
  // every other "correction" route handler in this app the same pass.
  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/redirects?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/redirects", req));
}
