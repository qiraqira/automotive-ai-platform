import type { NextFunction, Request, Response } from "express";

// Real, minimal implementation of spec §48's "cheap check that runs
// first" — fixed-window rate limiting per IP, applied to the endpoints
// docs/security.md names explicitly (login, search; comment/contact
// forms will join once those endpoints exist for real). In-memory, not
// Redis-backed: this dev environment has no Redis compatible with this
// project's other infrastructure needs (see project memory's BullMQ
// note), and a single-process in-memory limiter is a real, honest MVP —
// documented simplification, not a hidden one, same posture as the
// redirect lookup's own documented "one lookup per request, revisit at
// scale" note. Known limitation: doesn't share state across multiple
// server instances/processes. The fuller spec §48 list (CAPTCHA-
// equivalent challenge, behavioral heuristics) isn't implemented — this
// is the first line of defense, not the whole anti-spam system.

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface Window {
  count: number;
  windowStart: number;
}

export function rateLimit({ windowMs, max }: RateLimitOptions) {
  const hits = new Map<string, Window>();
  let requestsSincePrune = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();

    // Opportunistic cleanup so `hits` doesn't grow unbounded over a long
    // process lifetime with many distinct IPs — every 1000 requests
    // through any rate-limited route, not a separate timer (keeps this
    // dependency-free and trivially testable).
    requestsSincePrune += 1;
    if (requestsSincePrune >= 1000) {
      requestsSincePrune = 0;
      for (const [k, w] of hits) {
        if (now - w.windowStart >= windowMs) hits.delete(k);
      }
    }

    const entry = hits.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > max) {
      res.setHeader("Retry-After", Math.ceil((entry.windowStart + windowMs - now) / 1000));
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    next();
  };
}
