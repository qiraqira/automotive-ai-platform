import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Publish" button on
// /admin/articles — same zero-client-JS pattern as
// /api/admin/alerts/[id]/resolve. Forwards to apps/api's real
// PATCH /v1/admin/articles/:id/publish (requires PUBLISH_ARTICLE).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  const apiRes = await adminFetch(`/v1/admin/articles/${id}/publish`, { method: "PATCH" });

  if (!apiRes.ok) {
    const error = apiRes.status === 403 ? "forbidden" : apiRes.status === 404 ? "not_found" : "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/articles?status=DRAFT&error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/articles?status=PUBLISHED", req));
}
