import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the per-car-model correction
// form on /admin/cars — forwards to the real PATCH /v1/cars/:brandSlug/
// :modelSlug. Real gap found and fixed 2026-09-07: every other admin
// entity built today got both a create AND a correct path —
// Brand/CarModel only ever got create, until now.
export async function POST(req: NextRequest, { params }: { params: Promise<{ brand: string; model: string }> }) {
  await requireAdminSession();
  const { brand, model } = await params;
  const form = await req.formData();

  const apiRes = await adminFetch(`/v1/cars/${brand}/${model}`, {
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
