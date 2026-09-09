import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminFetch, adminRedirectUrl } from "@/lib/admin-auth";

// The "upload your own if free stock didn't find anything" flow (user's
// explicit instruction — search Wikimedia Commons first, upload one
// manually, e.g. ChatGPT-generated, when nothing free was found). Real
// magic-byte sniffing, not a trusted client-supplied Content-Type — an
// admin session is already required, but this project's own established
// posture (see apps/api's malformed-upload/content-type gaps found
// elsewhere this session) is to verify file content directly rather than
// trust what the browser claims.
const MAX_BYTES = 10 * 1024 * 1024;
// Deliberately NOT under public/ — see apps/web/src/app/uploads/
// [filename]/route.ts's own comment on why (next start doesn't serve a
// public/ file added after the server booted; a real Route Handler
// there reads this same directory fresh on every request instead).
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

function sniffImageType(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireAdminSession();
  const { id } = await params;

  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.redirect(adminRedirectUrl(`/admin/articles?status=DRAFT&error=no_file`, req));
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.redirect(adminRedirectUrl(`/admin/articles?status=DRAFT&error=file_too_large`, req));
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    return NextResponse.redirect(adminRedirectUrl(`/admin/articles?status=DRAFT&error=invalid_image`, req));
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = `${randomUUID()}.${sniffed.ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, filename), bytes);

  const apiRes = await adminFetch(`/v1/admin/articles/${id}/hero-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `/uploads/${filename}`, sha256, mimeType: sniffed.mime }),
  });

  if (!apiRes.ok) {
    const error = apiRes.status === 403 ? "forbidden" : apiRes.status === 404 ? "not_found" : "unknown_error";
    return NextResponse.redirect(adminRedirectUrl(`/admin/articles?status=DRAFT&error=${encodeURIComponent(error)}`, req));
  }

  return NextResponse.redirect(adminRedirectUrl("/admin/articles?status=DRAFT", req));
}
