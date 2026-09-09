import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Add engine" form on
// /admin/cars — forwards to the real POST /v1/trims/:id/engines. Real
// gap found and fixed 2026-09-07: the last leaf of the real Generation
// -> Trim -> Engine/Battery hierarchy with no create path.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  const form = await req.formData();
  const powerKw = form.get("powerKw");
  const powerHp = form.get("powerHp");
  const fuel = form.get("fuel");

  const apiRes = await adminFetch(`/v1/trims/${id}/engines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: form.get("name"),
      powerKw: powerKw ? Number(powerKw) : undefined,
      powerHp: powerHp ? Number(powerHp) : undefined,
      fuel: fuel ? fuel : undefined,
    }),
  });

  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/cars?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/cars", req));
}
