import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

// Real hero-image serving for both the manual-upload flow
// (api/admin/articles/[id]/upload-image) and apps/worker/src/
// generate-image.ts's OpenAI output — a genuine Route Handler, not a
// public/ static file. Real gap found and fixed live 2026-09-08: `next
// start` only serves public/ files that existed at server boot; a file
// written there afterward 404s until the next restart (confirmed live —
// the exact same generated image served 200 only after a plain
// `docker compose restart web`). A Route Handler runs fresh per request
// and reads straight from disk, so a newly-written file is servable
// immediately with no restart. See apps/web/uploads/.gitkeep for the
// full story and infrastructure/docker/docker-compose.yml for the real
// shared volume this reads from.
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;

  // Real path-traversal guard, not decorative — this reads directly off
  // disk from a user/API-controlled path segment. Only a bare
  // "<safe-chars>.<known-ext>" is ever accepted; anything with a `/`,
  // `..`, or an unrecognized extension is rejected before touching the
  // filesystem.
  if (!/^[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/.test(filename)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const bytes = await readFile(path.join(UPLOAD_DIR, filename));
    const ext = path.extname(filename).toLowerCase();
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
        // Safe to cache aggressively — filenames are real random UUIDs
        // (crypto.randomUUID()), never reused for different content.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
