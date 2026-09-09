import path from "node:path";
import { defineConfig } from "@playwright/test";

// Real E2E tier (spec §59's third test tier — apps/api has integration
// tests, packages/* have unit tests, this is the first suite that drives
// an actual browser against actual running apps/api + apps/web servers).
// Uses dedicated ports (not 3000/4000) so this can run alongside a
// manually-started dev server without colliding. Plain `__dirname`, not
// `import.meta.url`: apps/web has no "type": "module" in package.json, so
// Playwright loads this config as CJS, where `__dirname` is already
// available and `import.meta` is a syntax error.
const repoRoot = path.resolve(__dirname, "../..");

const WEB_PORT = process.env.E2E_WEB_PORT ?? "3100";
const API_PORT = process.env.E2E_API_PORT ?? "4100";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
  },
  // "setup" runs auth.setup.ts once (a real login, see that file's
  // comment for why this exists) before "chromium" runs everything else
  // — specs that need an authenticated admin session opt in per-describe
  // via `test.use({ storageState: adminAuthFile })`, so logged-out tests
  // (e.g. admin.spec.ts's "logged-out visit" / "wrong password" tests)
  // are unaffected by this project split.
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", dependencies: ["setup"] },
  ],
  webServer: [
    {
      command: "npm run dev --workspace @automotive/api",
      cwd: repoRoot,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { API_PORT },
    },
    {
      command: "npm run dev --workspace @automotive/web",
      cwd: repoRoot,
      url: `http://localhost:${WEB_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { WEB_PORT, API_INTERNAL_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
