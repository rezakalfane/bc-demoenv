/**
 * BC DemoEnv desktop shell. Runs the Next.js standalone server
 * (dist-electron/server, built by scripts/build-electron.mjs) as a plain-node
 * child process on localhost and shows it in a BrowserWindow. No IPC, no
 * preload: the renderer is the same web app the browser gets.
 *
 * Everything writable lives in the user data dir
 * (~/Library/Application Support/BC DemoEnv):
 *   local.db        SQLite database, seeded from dist-electron/seed.db once
 *   workflow-data/  Workflow SDK local world (runs, steps, queue)
 *   config.env      optional overrides, applied over the bundled app.env
 *   logs/server.log Next.js server output
 *
 * Vercel Cron does not exist locally, so the shell calls /api/scheduler/tick
 * every minute with a per-launch CRON_SECRET.
 */
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import { spawn } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const APP_NAME = "BC DemoEnv";
const PREFERRED_PORT = 3210;
const SERVER_START_TIMEOUT_MS = 60_000;
const SCHEDULER_TICK_MS = 60_000;
const SERVER_MAX_RESTARTS = 3;

// Same user data dir for `electron .` (dev) and the packaged app.
app.setName(APP_NAME);
app.setPath("userData", join(app.getPath("appData"), APP_NAME));

const userData = app.getPath("userData");
// Packaged: extraResources land in Contents/Resources. Dev: the repo build output.
const resources = app.isPackaged
  ? process.resourcesPath
  : join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist-electron");
const overridesPath = join(userData, "config.env");
const logPath = join(userData, "logs", "server.log");
const cronSecret = randomBytes(24).toString("hex");

let server = null;
let serverRestarts = 0;
let quitting = false;
let origin = null;
let mainWindow = null;
let schedulerTimer = null;

const OVERRIDES_TEMPLATE = `# ${APP_NAME} overrides — applied over the bundled environment on launch.
# Restart the app after editing. Examples:
#
# Use the remote Turso database instead of the local SQLite file:
# TURSO_DATABASE_URL=libsql://your-db.turso.io
# TURSO_AUTH_TOKEN=...
#
# ABLY_API_KEY=...
`;

function readEnvFile(path) {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

function prepareUserData() {
  mkdirSync(join(userData, "logs"), { recursive: true });
  mkdirSync(join(userData, "workflow-data"), { recursive: true });
  const db = join(userData, "local.db");
  const seed = join(resources, "seed.db");
  if (!existsSync(db) && existsSync(seed)) copyFileSync(seed, db);
  if (!existsSync(overridesPath)) writeFileSync(overridesPath, OVERRIDES_TEMPLATE, { mode: 0o600 });
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(null));
    probe.listen(port, host, () => {
      const bound = probe.address().port;
      probe.close(() => resolve(bound));
    });
  });
}

// The port must be free on BOTH loopbacks: Next (via Clerk's middleware
// rewrite) and Chromium reach the server as `localhost`, which resolves to ::1
// first. A dev server holding only [::]:port would otherwise answer those
// requests while ours sits on 127.0.0.1:port. Wildcards are probed too:
// SO_REUSEADDR lets a specific-address bind succeed next to a wildcard holder.
const PROBE_HOSTS = ["::1", "::", "0.0.0.0"];

async function findPort(preferred) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await canListen(attempt === 0 ? preferred : 0, "127.0.0.1");
    if (!port) continue;
    let free = true;
    for (const host of PROBE_HOSTS) free = free && Boolean(await canListen(port, host));
    if (free) return port;
  }
  throw new Error("No free localhost port");
}

function serverEnv(port) {
  return {
    ...process.env,
    ...readEnvFile(join(resources, "app.env")),
    // server.js chdirs into its own (read-only) folder: every writable path is absolute.
    TURSO_DATABASE_URL: `file:${join(userData, "local.db")}`,
    ...readEnvFile(overridesPath),
    NODE_ENV: "production",
    PORT: String(port),
    // `localhost`, not 127.0.0.1: NextURL rewrites loopback hosts to localhost,
    // so with HOSTNAME=127.0.0.1 middleware rewrites (Clerk) look cross-origin
    // and Next proxies them back to itself in a loop.
    HOSTNAME: "localhost",
    WORKFLOW_LOCAL_DATA_DIR: join(userData, "workflow-data"),
    WORKFLOW_LOCAL_BASE_URL: `http://localhost:${port}`,
    CRON_SECRET: cronSecret,
    NEXT_TELEMETRY_DISABLED: "1",
    // Plain node, also for anything the server spawns via process.execPath.
    ELECTRON_RUN_AS_NODE: "1",
  };
}

function startServer(port) {
  const log = createWriteStream(logPath, { flags: "a" });
  log.write(`\n--- ${new Date().toISOString()} starting on port ${port}\n`);
  const child = spawn(process.execPath, [join(resources, "server", "electron-entry.cjs")], {
    env: serverEnv(port),
    // stdin stays open: electron-entry.cjs exits when it closes.
    stdio: ["pipe", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      log.write(chunk);
      if (!app.isPackaged) process.stdout.write(chunk);
    });
  }
  child.on("exit", (code, signal) => {
    log.end(`--- exited (${code ?? signal})\n`);
    if (server !== child) return;
    server = null;
    if (quitting) return;
    if (serverRestarts >= SERVER_MAX_RESTARTS) {
      dialog.showErrorBox(`${APP_NAME} server stopped`, `The local server exited (${code ?? signal}). See ${logPath}`);
      return;
    }
    serverRestarts += 1;
    setTimeout(() => {
      if (!quitting) server = startServer(port);
    }, 1000 * serverRestarts);
  });
  return child;
}

async function waitForServer(url) {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // Any HTTP response (sign-in redirect included) means Next is listening.
      await fetch(url, { redirect: "manual" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`The local server did not respond within ${SERVER_START_TIMEOUT_MS / 1000}s`);
}

function startScheduler() {
  schedulerTimer = setInterval(() => {
    if (!server) return;
    fetch(`${origin}/api/scheduler/tick`, { headers: { authorization: `Bearer ${cronSecret}` } })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (body.dispatched) console.log(`[scheduler] dispatched ${body.dispatched}`);
      })
      .catch(() => undefined);
  }, SCHEDULER_TICK_MS);
}

const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><body style="margin:0;height:100vh;display:grid;place-items:center;font:15px -apple-system,system-ui;background:#0f172a;color:#cbd5e1">
<div>Starting ${APP_NAME}…</div></body></html>`)}`;

function openWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#0f172a",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Same-origin popups stay in the app; everything else opens in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (origin && url.startsWith(origin)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  void win.loadURL(origin ?? SPLASH);
  return win;
}

function installMenu() {
  const template = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        { label: "New Window", accelerator: "CmdOrCtrl+N", click: () => origin && openWindow() },
        { type: "separator" },
        { label: "Open Data Folder", click: () => void shell.openPath(userData) },
        { label: "Edit Overrides (config.env)", click: () => void shell.openPath(overridesPath) },
        { label: "Show Server Log", click: () => void shell.openPath(logPath) },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function boot() {
  prepareUserData();
  installMenu();
  mainWindow = openWindow();
  const port = await findPort(PREFERRED_PORT);
  const url = `http://localhost:${port}`;
  server = startServer(port);
  try {
    await waitForServer(url);
  } catch (error) {
    dialog.showErrorBox(`${APP_NAME} failed to start`, `${error.message}\n\nSee ${logPath}`);
    app.quit();
    return;
  }
  origin = url;
  console.log(`[${APP_NAME}] ${origin} (data: ${userData})`);
  mainWindow?.loadURL(origin);
  startScheduler();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) mainWindow = openWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on("activate", () => {
    if (!mainWindow && origin) mainWindow = openWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", () => {
    quitting = true;
    clearInterval(schedulerTimer);
    server?.kill("SIGTERM");
  });
  void app.whenReady().then(boot);
}
