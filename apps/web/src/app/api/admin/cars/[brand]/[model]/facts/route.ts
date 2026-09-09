import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Add fact" form on
// /admin/cars — forwards to the real POST
// /v1/cars/:brandSlug/:modelSlug/facts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ brand: string; model: string }> }) {
  await requireAdminSession();
  const { brand, model } = await params;
  const form = await req.formData();
  const unit = form.get("unit");
  const marketId = form.get("marketId");

  const apiRes = await adminFetch(`/v1/cars/${brand}/${model}/facts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      attribute: form.get("attribute"),
      value: form.get("value"),
      unit: unit ? unit : undefined,
      marketId: marketId ? marketId : undefined,
    }),
  });

  // Real gap found and fixed 2026-09-07: unlike every other real
  // "create" route handler in this app (which all check apiRes.ok and
  // surface `?error=`), this one discarded the real API response
  // entirely — the one create-flow outlier in an otherwise-consistent
  // pattern, found while fixing the far more widespread gap across
  // every "correction" route handler the same pass.
  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/cars?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/cars", req));
}
