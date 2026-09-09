import type { NextFunction, Request, Response } from "express";
import { prisma, PermissionKey } from "@automotive/database";
import { env } from "@automotive/config";
import { verifySession } from "./auth.js";

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
  }
}

/** Reads the session cookie, verifies the JWT, and (if valid) attaches
 * `req.userId` — does NOT reject unauthenticated requests itself, since
 * some routes (public reads) don't need a session at all. Use
 * `requirePermission` on routes that do. */
export function attachSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[env.AUTH_COOKIE_NAME];
  if (token) {
    const session = verifySession(token);
    if (session) req.userId = session.userId;
  }
  next();
}

/** Every mutating endpoint checks the caller's actual RolePermission set
 * against the database — including when the caller is the AI agent's own
 * service account (docs/security.md "RBAC"). No endpoint trusts a claim of
 * "I'm an admin" without looking it up.
 *
 * Real gap found and fixed 2026-09-07: this check never looked at
 * `User.status` — only whether a `UserRole` grant existed. `PATCH
 * /v1/users/:id/status` (the real "Suspend" button on `/admin/users`,
 * built and E2E-tested earlier the same day) only ever updates
 * `User.status`; it never touches `UserRole` rows. Combined with a real
 * 7-day JWT session (`auth.ts`'s `JWT_EXPIRY`), the actual, verified
 * behavior was: suspending a user did nothing at all for anyone who
 * already had a live session — every permission check kept passing,
 * for up to 7 real days, exactly as before the suspension. Not a
 * theoretical gap: this is the entire point of a "Suspend" feature,
 * verified broken by tracing what this function actually checks against
 * what `PATCH /v1/users/:id/status` actually changes. `POST
 * /v1/auth/login` already correctly rejects a non-ACTIVE user from
 * establishing a *new* session — the gap was purely "revoke an
 * existing one," which nothing did anywhere. Fixed by folding a
 * `user: { status: "ACTIVE" }` condition into this same query (one
 * round trip, not a second lookup) — a suspended user's every
 * subsequent permission-gated request now genuinely fails, in real
 * time, not just on their next fresh login attempt. */
export function requirePermission(key: PermissionKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }

    const grant = await prisma.userRole.findFirst({
      where: {
        userId: req.userId,
        user: { status: "ACTIVE" },
        role: { permissions: { some: { permission: { key } } } },
      },
    });

    if (!grant) {
      res.status(403).json({ error: "forbidden", requiredPermission: key });
      return;
    }

    next();
  };
}
