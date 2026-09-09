import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    correlationId: string;
  }
}

// docs/security.md "Observability": "Structured (JSON) logs from api/
// worker, one log line per request/job with a correlation id" — real gap
// found 2026-09-07, this didn't exist at all (the only console output in
// apps/api was the startup line in index.ts). Plain console.log of a JSON
// string, not a logging library dependency: this is the simplest reliable
// implementation of "structured JSON logs" and matches this project's
// existing preference for the simplest option that actually satisfies the
// requirement (same reasoning as the in-memory rate limiter over adding
// Redis). A real log aggregator in production reads stdout regardless of
// which one produced it.
//
// Reuses an incoming X-Request-Id if the caller already set one (lets a
// request be correlated across services — e.g. apps/web's proxy could
// pass one through), generates one otherwise. Echoed back as a response
// header so a client/test can correlate its own request to this log line.
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const correlationId = req.header("x-request-id") ?? randomUUID();
  req.correlationId = correlationId;
  res.setHeader("X-Request-Id", correlationId);

  const start = Date.now();
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        correlationId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      }),
    );
  });

  next();
}
