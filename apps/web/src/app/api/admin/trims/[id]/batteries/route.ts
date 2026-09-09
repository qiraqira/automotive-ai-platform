import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Add battery" form on
// /admin/cars — forwards to the real POST /v1/trims/:id/batteries.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  const form = await req.formData();
  const capacityKwh = form.get("capacityKwh");
  const rangeKm = form.get("rangeKm");

  const apiRes = await adminFetch(`/v1/trims/${id}/batteries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      capacityKwh: capacityKwh ? Number(capacityKwh) : undefined,
      rangeKm: rangeKm ? Number(rangeKm) : undefined,
    }),
  });

  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/cars?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/cars", req));
}
