import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the per-fact "Update" button on
// /admin/cars — same proxy pattern as /api/admin/alerts/[id]/resolve,
// forwarding to the real PATCH /v1/facts/:id (see apps/api/src/app.ts's
// "Admin: car fact correction" section, added 2026-09-07 to close the
// UPDATE_CAR gap).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  const form = await req.formData();
  const unit = form.get("unit");

  const apiRes = await adminFetch(`/v1/facts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: form.get("value"), unit: unit ? unit : undefined }),
  });

  // Real gap found and fixed 2026-09-07: this discarded the real API
  // response entirely and always redirected as if the correction
  // succeeded — same missing-error-check gap found across every other
  // "correction" route handler in this app the same pass.
  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/cars?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/cars", req));
}
