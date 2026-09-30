/**
 * Assembles everything the Electron shell (electron/main.mjs) ships as
 * extraResources, under dist-electron/:
 *
 *   server/     Next.js standalone server (server.js + traced node_modules)
 *               with .next/static and public/ copied in, plus
 *               electron-entry.cjs (exits when the Electron parent goes away).
 *   app.env     Server-side runtime env taken from the same .env files
 *               `next build` read, minus database/Vercel/cron keys: the desktop
 *               app owns its database and scheduler.
 *   seed.db     Consistent copy of local.db (sqlite3 .backup) copied into the
 *               user data dir on first launch.
 *
 *   node scripts/build-electron.mjs     (npm run build:electron)
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";

const root = process.cwd();
const out = join(root, "dist-electron");
const standalone = join(root, ".next", "standalone");

// Keys the desktop app must not inherit from the developer's env files.
const EXCLUDED_ENV = [/^TURSO_/, /^LOCAL_DATABASE_URL$/, /^VERCEL/, /^CRON_SECRET$/, /^NODE_ENV$/];

execFileSync("npx", ["next", "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_OUTPUT_STANDALONE: "1" },
});
if (!existsSync(join(standalone, "server.js"))) {
  throw new Error("next build did not produce .next/standalone/server.js");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Standalone output does not include static assets; server.js serves them
// once copied next to it.
const server = join(out, "server");
cpSync(standalone, server, { recursive: true, verbatimSymlinks: true });
cpSync(join(root, ".next", "static"), join(server, ".next", "static"), { recursive: true });
cpSync(join(root, "public"), join(server, "public"), { recursive: true });
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  rmSync(join(server, name), { force: true });
}
writeFileSync(
  join(server, "electron-entry.cjs"),
  `// Spawned by electron/main.mjs with ELECTRON_RUN_AS_NODE=1. stdin is a pipe
// held by the Electron main process: when it closes (quit or crash) the
// server exits instead of lingering as an orphan holding the port.
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
require("./server.js");
`,
);

const { parsedEnv = {} } = nextEnv.loadEnvConfig(root, false, { info() {}, error: console.error });
const lines = Object.entries(parsedEnv)
  .filter(([key]) => !EXCLUDED_ENV.some((pattern) => pattern.test(key)))
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`);
writeFileSync(join(out, "app.env"), `${lines.join("\n")}\n`, { mode: 0o600 });
console.log(`[electron] app.env: ${lines.map((line) => line.split("=")[0]).join(", ")}`);

const localDb = join(root, "local.db");
if (existsSync(localDb)) {
  execFileSync("sqlite3", [localDb, `.backup '${join(out, "seed.db")}'`]);
  console.log("[electron] seed.db: copied from local.db");
} else {
  console.log("[electron] seed.db: none (local.db missing) — the app starts with an empty database");
}
