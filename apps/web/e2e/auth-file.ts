import path from "node:path";

// Shared path constant only — kept out of auth.setup.ts because
// Playwright refuses to let one test file import another (auth.setup.ts
// counts as a test file since it calls `setup(...)`), and both it and
// the specs that consume the saved session need this same path.
export const adminAuthFile = path.join(__dirname, ".auth/admin.json");
