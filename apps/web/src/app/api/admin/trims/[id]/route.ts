import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the per-trim correction form on
// /admin/cars — forwards to the real PATCH /v1/trims/:id.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  const form = await req.formData();

  const apiRes = await adminFetch(`/v1/trims/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: form.get("name") }),
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
