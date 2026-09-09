#!/usr/bin/env node
// Real gap this closes: `packages/config/src/index.ts`'s schema is the
// single source of truth for every env var `apps/api`/`apps/worker`
// actually read (its own top comment: "The ONLY place in the codebase
// that should read `process.env` directly for these values"), and
// `.env.example` is meant to be the real template a deployer copies to
// their own `.env` (docs/security.md's "Secrets" section, `.env.example
// documents every variable with no real values"). If the schema ever
// grows a new required key that never gets added to `.env.example` too,
// a deployer following the normal, documented workflow (copy
// `.env.example` to `.env`) would hit a real, confusing startup crash —
// this has already been the exact real shape of two prior bugs this
// project's own history recorded (the boolean/`"false"` coercion gap,
// the empty-string-bypasses-default gap), just checked by hand each
// time rather than automatically. This script closes that gap for good:
// it parses the real schema keys straight from the real source file
// (never hand-copied) and checks every one has a real `.env.example`
// entry. The reverse direction (an `.env.example` key the schema
// doesn't require yet, e.g. the `STORAGE_*` vars provisioned ahead of
// the not-yet-built image-upload feature) is deliberately NOT an error
// here — `.env.example` documenting more than current code strictly
// needs is a legitimate, forward-looking pattern already established in
// this project, not drift.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_SRC = path.join(ROOT, "packages", "config", "src", "index.ts");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");

function extractSchemaKeys(source) {
  const start = source.indexOf("const schema = z.object({");
  if (start === -1) throw new Error("Could not find `const schema = z.object({` in packages/config/src/index.ts — has it moved or been renamed?");
  const openBraceIdx = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = openBraceIdx; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("Could not find the matching closing brace for the schema object.");
  const body = source.slice(openBraceIdx + 1, end);

  const keys = [];
  const re = /^\s*([A-Z][A-Z0-9_]*):\s*/gm;
  let match;
  while ((match = re.exec(body)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

function extractEnvExampleKeys(source) {
  const keys = new Set();
  const re = /^([A-Z][A-Z0-9_]*)=/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

function main() {
  const configSource = fs.readFileSync(CONFIG_SRC, "utf8");
  const envExampleSource = fs.readFileSync(ENV_EXAMPLE, "utf8");

  const schemaKeys = extractSchemaKeys(configSource);
  const envExampleKeys = extractEnvExampleKeys(envExampleSource);

  const missing = schemaKeys.filter((k) => !envExampleKeys.has(k));

  if (missing.length > 0) {
    console.error(
      `[verify-env-example] FAILED — packages/config's schema requires ${missing.length} env var(s) with no matching .env.example entry: ${missing.join(", ")}`,
    );
    console.error("  A deployer copying .env.example to .env (the normal, documented workflow) would never see these vars at all.");
    process.exit(1);
  }

  console.log(`[verify-env-example] OK — all ${schemaKeys.length} real packages/config schema keys have a matching .env.example entry.`);
}

main();
