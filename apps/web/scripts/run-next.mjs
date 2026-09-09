// Cross-platform port handling for "next dev"/"next start". package.json
// scripts can't use `${WEB_PORT:-3000}` bash-style expansion — npm invokes
// scripts through cmd.exe on Windows, which doesn't understand that
// syntax and fails with "argument '${WEB_PORT:-3000}' is invalid" (found
// while running this repo's own dev server on this dev machine). Reading
// the env var in Node instead works identically on every platform.
import { spawn } from "node:child_process";

const subcommand = process.argv[2]; // "dev" | "start"
if (subcommand !== "dev" && subcommand !== "start") {
  throw new Error(`Expected "dev" or "start", got: ${subcommand}`);
}
const port = Number(process.env.WEB_PORT ?? 3000);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`WEB_PORT must be a positive integer, got: ${process.env.WEB_PORT}`);
}

// Single command string, not an argv array, since shell:true is required
// on Windows to resolve "next" (a .cmd shim, not a raw binary) — Node
// warns if you combine shell:true with an array because array elements
// aren't shell-escaped. Safe here: both inputs are validated above, not
// passed through raw.
const child = spawn(`next ${subcommand} -p ${port}`, { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
