import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the source-correction controls on
// /admin — forwards to the real, long-existing PATCH /v1/sources/:id
// (MANAGE_SOURCES-gated). Real gap found and fixed 2026-09-07: this
// endpoint has existed since early in this project (predating today's
// session) and is fully tested, but nothing in apps/web had ever called
// it — every real use of it before today was via curl or a test client.
// Same formData-to-JSON-then-adminFetch pattern as every other admin
// mutation here.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  const form = await req.formData();

  const body: Record<string, unknown> = {};
  const active = form.get("active");
  if (active !== null) body.active = active === "true";
  const trustScore = form.get("trustScore");
  if (trustScore !== null) body.trustScore = Number(trustScore);
  const crawlInterval = form.get("crawlInterval");
  if (crawlInterval !== null) body.crawlInterval = Number(crawlInterval);

  const apiRes = await adminFetch(`/v1/sources/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Real gap found and fixed 2026-09-07: this discarded the real API
  // response entirely and always redirected as if the correction
  // succeeded — the same missing-error-check gap found across every
  // other "correction" route handler in this app the same pass.
  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin", req));
}
