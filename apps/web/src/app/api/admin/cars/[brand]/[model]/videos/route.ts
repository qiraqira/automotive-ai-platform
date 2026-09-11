import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Add video" form on
// /admin/cars — forwards to the real POST /v1/cars/:brand/:model/videos.
// Same shape as the sibling facts/generations route handlers: forward the
// form, redirect back with an ?error= on failure, the API does the real
// YouTube-URL validation (extractYoutubeId) rather than this handler
// guessing at it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ brand: string; model: string }> }) {
  await requireAdminSession();
  const { brand, model } = await params;
  const form = await req.formData();

  const apiRes = await adminFetch(`/v1/cars/${brand}/${model}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: form.get("url"),
      title: form.get("title"),
      category: form.get("category"),
    }),
  });

  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/cars?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/cars", req));
}
