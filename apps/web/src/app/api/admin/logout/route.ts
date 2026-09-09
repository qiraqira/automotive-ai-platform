import { NextRequest, NextResponse } from "next/server";
import { adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// Plain <form method="post"> target for the "Log out" control on every
// admin page. Real gap found and fixed 2026-09-07: `POST /v1/auth/logout`
// has existed the whole project (it correctly clears the real session
// cookie), but nothing in apps/web ever called it — there was no way to
// log out through the UI at all, only by manually clearing cookies.
// Deliberately does NOT call requireAdminSession() first: a user with an
// already-invalid/expired session should still be able to hit "Log out"
// and land cleanly on the login page, not get redirected there anyway
// with an extra round trip.
export async function POST(req: NextRequest) {
  const apiRes = await adminFetch("/v1/auth/logout", { method: "POST" });
  const res = NextResponse.redirect(adminRedirectUrl("/admin/login", req));
  const setCookie = apiRes.headers.get("set-cookie");
  if (setCookie) res.headers.set("set-cookie", setCookie);
  return res;
}
