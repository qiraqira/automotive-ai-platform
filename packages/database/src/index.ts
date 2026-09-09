import { PrismaClient } from "@prisma/client";

// One shared client per process — avoid exhausting Postgres connections by
// creating a new PrismaClient per import in a hot-reloading dev server.
declare global {
  // eslint-disable-next-line no-var
  var __automotivePrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__automotivePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__automotivePrisma = prisma;
}

export * from "@prisma/client";
