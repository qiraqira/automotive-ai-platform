import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Add generation" form on
// /admin/cars — forwards to the real POST /v1/cars/:brand/:model/
// generations. Real gap found and fixed 2026-09-07: a freshly-created
// CarModel could only ever gain flat Facts, never a real generation.
export async function POST(req: NextRequest, { params }: { params: Promise<{ brand: string; model: string }> }) {
  await requireAdminSession();
  const { brand, model } = await params;
  const form = await req.formData();
  const startYear = form.get("startYear");
  const endYear = form.get("endYear");

  const apiRes = await adminFetch(`/v1/cars/${brand}/${model}/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug: form.get("slug"),
      name: form.get("name"),
      startYear: startYear ? Number(startYear) : undefined,
      endYear: endYear ? Number(endYear) : undefined,
    }),
  });

  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/cars?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/cars", req));
}
