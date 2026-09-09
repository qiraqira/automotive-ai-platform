import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "@automotive/config";

const JWT_EXPIRY = "7d";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface SessionPayload {
  userId: string;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.AUTH_JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, env.AUTH_JWT_SECRET) as SessionPayload;
  } catch {
    return null;
  }
}
