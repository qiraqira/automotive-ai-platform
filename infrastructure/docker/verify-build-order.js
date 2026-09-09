#!/usr/bin/env node
// Real gap found and fixed 2026-09-08: each of the three Dockerfiles in
// this directory has its own comment admitting its `RUN npm run build
// --workspace ...` sequence "drifted out of sync" with the real
// packages/*/package.json dependency graph multiple separate times
// (2026-09-07) — caught only by manually re-simulating the build order
// by hand each time, since nothing enforced it automatically. Docker
// itself can't run on this dev machine (no daemon), so a real `docker
// build` failure was never available as a safety net either. This script
// is that missing automatic check: it reads the REAL dependency graph
// straight from every packages/*/package.json (never hand-copied or
// assumed) and verifies each Dockerfile's build steps (a) include every
// package the app transitively depends on, with no extras, and (b) build
// each package strictly after every one of its own @automotive/*
// dependencies. Exits non-zero with a specific, actionable message on
// any drift, so this is safe to wire into CI even though Docker itself
// can't run there either — the actual RUN line text is what's checked,
// not a real build.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

const TARGETS = [
  { dockerfile: "Dockerfile.api", appPkg: "apps/api" },
  { dockerfile: "Dockerfile.web", appPkg: "apps/web" },
  { dockerfile: "Dockerfile.worker", appPkg: "apps/worker" },
];

function readPkg(relDir) {
  const pkgPath = path.join(ROOT, relDir, "package.json");
  return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
}

function internalDeps(pkgJson) {
  const deps = { ...(pkgJson.dependencies || {}) };
  return Object.keys(deps).filter((name) => name.startsWith("@automotive/"));
}

// Every packages/* directory that has its own package.json, keyed by its
// real declared "name" field (not the directory name) so this stays
// correct even if a directory name and its package name ever diverge.
function loadAllPackages() {
  const dir = path.join(ROOT, "packages");
  const byName = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(dir, entry.name, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    byName[pkgJson.name] = { dir: entry.name, deps: internalDeps(pkgJson) };
  }
  return byName;
}

function transitiveClosure(startDeps, allPackages) {
  const seen = new Set();
  const stack = [...startDeps];
  while (stack.length > 0) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const pkg = allPackages[name];
    if (!pkg) {
      throw new Error(`Unknown internal package "${name}" — no packages/*/package.json declares this name.`);
    }
    for (const dep of pkg.deps) stack.push(dep);
  }
  return seen;
}

function parseBuildOrder(dockerfilePath) {
  const text = fs.readFileSync(dockerfilePath, "utf8");
  const order = [];
  const re = /^RUN npm run build --workspace (@automotive\/[a-zA-Z0-9_-]+)\s*$/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    order.push(match[1]);
  }
  return order;
}

function main() {
  const allPackages = loadAllPackages();
  let failed = false;

  for (const { dockerfile, appPkg } of TARGETS) {
    const appPkgJson = readPkg(appPkg);
    const appName = appPkgJson.name;
    const dockerfilePath = path.join(ROOT, "infrastructure", "docker", dockerfile);
    const buildOrder = parseBuildOrder(dockerfilePath);

    const requiredInternalDeps = transitiveClosure(internalDeps(appPkgJson), allPackages);
    const builtSet = new Set(buildOrder);

    // (a) every required package/build step is present
    const missing = [...requiredInternalDeps].filter((name) => !builtSet.has(name));
    if (missing.length > 0) {
      failed = true;
      console.error(`[verify-build-order] ${dockerfile}: MISSING build step(s) for: ${missing.join(", ")}`);
      console.error(`  ${appName} transitively depends on these but they're never built before ${appName} itself.`);
    }

    // the app's own build step must be present and last
    if (buildOrder[buildOrder.length - 1] !== appName) {
      failed = true;
      console.error(
        `[verify-build-order] ${dockerfile}: the app's own build step (${appName}) must be the LAST "RUN npm run build" line — found: ${buildOrder.join(" -> ") || "(none)"}`,
      );
    }

    // (b) order-correctness: every package must be built after its own deps
    const position = new Map(buildOrder.map((name, i) => [name, i]));
    for (const name of buildOrder) {
      const pkg = allPackages[name] ?? (name === appName ? { deps: internalDeps(appPkgJson) } : null);
      if (!pkg) continue;
      for (const dep of pkg.deps) {
        if (!position.has(dep)) continue; // already reported as missing above
        if (position.get(dep) >= position.get(name)) {
          failed = true;
          console.error(
            `[verify-build-order] ${dockerfile}: "${name}" is built at position ${position.get(name)} but its dependency "${dep}" is built at position ${position.get(dep)} — ${dep} must build strictly before ${name}.`,
          );
        }
      }
    }

    if (missing.length === 0 && !failed) {
      console.log(`[verify-build-order] ${dockerfile}: OK (${buildOrder.join(" -> ")})`);
    }
  }

  if (failed) {
    console.error("\n[verify-build-order] FAILED — a Dockerfile's build order has drifted from the real packages/*/package.json dependency graph.");
    process.exit(1);
  }
  console.log("\n[verify-build-order] All 3 Dockerfiles match the real dependency graph.");
}

main();
