import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Resolve" button on
// /admin/alerts — this project's admin UI is zero-client-JS everywhere
// except the login form, so a real POST-then-redirect is the pattern,
// not a fetch() from a Client Component. Forwards to apps/api's real
// PATCH /v1/alerts/:id/resolve using the same session-cookie-forwarding
// adminFetch() the rest of /admin already uses.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;
  const apiRes = await adminFetch(`/v1/alerts/${id}/resolve`, { method: "PATCH" });

  // Real gap found and fixed 2026-09-07: this discarded the real API
  // response entirely — a real, if rare, race (someone else already
  // resolved or the alert no longer exists by the time this submits)
  // would silently redirect back as if it worked. Same missing-error-
  // check gap found across every other "correction"-style route
  // handler in this app the same pass.
  if (!apiRes.ok) {
    const data = (await apiRes.json().catch(() => ({}))) as { error?: string };
    const error = data.error ?? "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/alerts?error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/alerts", req));
}
