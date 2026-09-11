import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for each video's "Remove" button on
// /admin/cars — forwards to the real DELETE /v1/car-videos/:id. A plain
// HTML form can't send a DELETE verb itself, so the form POSTs here and
// this route makes the real DELETE call server-side.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;

  const apiRes = await adminFetch(`/v1/car-videos/${id}`, { method: "DELETE" });

  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/cars?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/cars", req));
}
