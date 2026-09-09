import { NextRequest, NextResponse } from "next/server";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

// Server-side proxy to apps/api's real /v1/auth/login — the browser only
// ever talks to apps/web's own origin (matches production, where nginx
// puts both behind one domain: infrastructure/nginx/nginx.conf), so this
// needs no CORS configuration on apps/api. The session cookie apps/api
// sets is forwarded straight through to the browser, unmodified.
export async function POST(req: NextRequest) {
  const body = await req.text();
  const apiRes = await fetch(`${API_INTERNAL_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await apiRes.text();
  const res = new NextResponse(data, {
    status: apiRes.status,
    headers: { "Content-Type": "application/json" },
  });

  const setCookie = apiRes.headers.get("set-cookie");
  if (setCookie) res.headers.set("set-cookie", setCookie);
  return res;
}
