import bcrypt from "bcryptjs";
import { prisma } from "./index.js";

// Real gap closed 2026-09-08 (docs/deployment.md flagged this as
// deliberately not built: "the real production admin account(s) still
// need to be created deliberately... not documented here yet since no
// such process has been built"). Unlike seed.ts, this takes real
// credentials from the environment — nothing hardcoded, nothing printed,
// safe to run in production. Requires bootstrapPlatformData() (bootstrap.ts,
// via `npm run db:seed` or a standalone bootstrap run) to have already
// created the "admin" Role — this refuses with a clear error rather than
// silently creating a User with no role if that hasn't happened yet.

const MIN_PASSWORD_LENGTH = 12;

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Administrator";

  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must both be set in the environment. Nothing is hardcoded here on purpose — see docs/deployment.md.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters — refusing to create an admin account with a weak password.`);
  }

  const adminRole = await prisma.role.findUnique({ where: { key: "admin" } });
  if (!adminRole) {
    throw new Error('The "admin" Role does not exist yet — run bootstrapPlatformData() first (e.g. `npm run db:seed` in development, or a standalone bootstrap step in production) before creating an admin user.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name, status: "ACTIVE" },
    create: { email, name, passwordHash, status: "ACTIVE" },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, roleId: adminRole.id },
  });

  // Deliberately never logs the password (unlike seed.ts's dev-only
  // credential, this one is real) — only confirms the email, matching the
  // "never log secrets" posture already established for this codebase.
  console.log(`Admin account ready: ${email} (role: admin, status: ACTIVE).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
