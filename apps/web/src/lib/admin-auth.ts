import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "automotive_session";
// Real gap found and fixed 2026-09-07: same reasoning as apps/web/src/
// lib/api.ts's own fix — every real admin page calls requireAdminSession()
// before rendering anything, so a hung apps/api would hang every real
// admin page load indefinitely with no fallback.
const API_FETCH_TIMEOUT_MS = 10_000;

export interface AdminSession {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

/** Server-side session check shared by every /admin/* page — forwards the
 * incoming cookie to apps/api's real /v1/auth/me so the check can never be
 * bypassed by a forged cookie the server never actually verifies.
 * Redirects to /admin/login on any failure. Extracted here once two pages
 * needed the identical check (/admin, /admin/stories) rather than
 * duplicating it a third time. */
export async function requireAdminSession(): Promise<AdminSession> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!sessionToken) redirect("/admin/login");

  const meRes = await fetch(`${API_INTERNAL_URL}/v1/auth/me`, {
    headers: { cookie: `${AUTH_COOKIE_NAME}=${sessionToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
  });
  if (meRes.status !== 200) redirect("/admin/login");

  return meRes.json() as Promise<AdminSession>;
}

/** Calls a permission-gated apps/api endpoint server-side, forwarding the
 * admin's own session cookie — for admin pages that need more than the
 * public read endpoints (e.g. /v1/alerts, MANAGE_SYSTEM_SETTINGS-gated).
 * Callers must have already called requireAdminSession() so a redirect on
 * missing/invalid session already happened; this assumes the cookie is
 * present. */
export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  return fetch(`${API_INTERNAL_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, cookie: `${AUTH_COOKIE_NAME}=${sessionToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
  });
}

// Real, severe bug found live 2026-09-08 (the first time any admin write
// action was ever exercised through the real public domain + nginx,
// rather than only via `next dev`/E2E's direct localhost access): every
// one of this app's ~24 admin POST route handlers built its
// success/error redirect as `new URL(path, req.url)` — verified live via
// curl against the real deployed site (not assumed) that in production,
// behind nginx, Next.js's own `req.url` resolves to this container's
// internal bind address (`http://localhost:3000`), not the real public
// domain the browser is actually talking to. Every admin form submission
// (Publish, Resolve, correct a fact, add a source, log out, ...) was
// silently redirecting a real browser to an address it can't reach —
// the button visibly "did nothing" (the POST itself succeeded — the
// redirect back to see the result is what failed). Fixed once, here,
// for every call site to share: use the real configured `PUBLIC_URL` as
// the redirect base whenever it's been set to something real (detected
// by checking it's not still `.env.example`'s literal placeholder
// default), falling back to the request's own origin otherwise — which
// stays correct for local dev/E2E, since those access the app directly
// with no reverse proxy in front of it.
export function adminRedirectUrl(path: string, req: NextRequest): URL {
  const configured = process.env.PUBLIC_URL;
  const base = configured && configured !== "https://DOMAIN.COM" ? configured : req.nextUrl.origin;
  return new URL(path, base);
}
