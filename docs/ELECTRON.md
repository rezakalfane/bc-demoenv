# Desktop app (Electron)

BC DemoEnv also ships as an unsigned macOS (arm64) desktop app. It runs the
same Next.js app: `next build` with `output: "standalone"` produces a
self-contained server that the Electron shell starts on `localhost` and shows
in a window. The Vercel build is unchanged (`NEXT_OUTPUT_STANDALONE` is unset
there).

```
npm run electron:dev   # build dist-electron/ and launch from the checkout
npm run dist:mac       # build + electron-builder → release/ (.app, dmg, zip)
npm run icon           # regenerate electron/icon.png + icon.icns
```

## Pieces

- `scripts/build-electron.mjs` — standalone build → `dist-electron/`:
  `server/` (server.js, traced node_modules, `.next/static`, `public/`,
  `electron-entry.cjs`), `app.env` (server-side env from the local `.env*`
  files minus `TURSO_*`, `LOCAL_DATABASE_URL`, `VERCEL*`, `CRON_SECRET`), and
  `seed.db` (a `sqlite3 .backup` of `local.db`).
- `electron/main.mjs` — starts the server as a plain-node child
  (`ELECTRON_RUN_AS_NODE=1`), restarts it up to 3 times, and quits it with the
  app. It also shows a splash until the server answers and opens foreign links
  in the default browser.
- electron-builder (`build` in package.json): `app.asar` holds only
  `electron/main.mjs`; `dist-electron/` is copied to `Contents/Resources/`.

## Data

`~/Library/Application Support/BC DemoEnv/`

| Path | What |
|---|---|
| `local.db` | SQLite database. Copied from `seed.db` on first launch, then independent of the repo's `local.db` |
| `workflow-data/` | Workflow SDK local world (runs, steps, queue) |
| `config.env` | Overrides applied over the bundled env. For example, set `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` to use the remote database. Restart after editing |
| `logs/server.log` | Next.js server output |

The File menu opens the data folder, `config.env` and the server log.

## Differences from the web deploy

- Runs with `NODE_ENV=production`: development-only panels (database
  Pull/Push, local scheduler dispatcher) are hidden.
- Vercel Cron is replaced by the shell calling `/api/scheduler/tick` every
  minute with a per-launch `CRON_SECRET`.
- Clerk uses the development instance keys from `.env.local`; those work on
  `http://localhost:<port>`.
- The server uses port 3210 when it's free on both IPv4 and IPv6 loopback,
  otherwise an ephemeral port. `HOSTNAME` must stay `localhost`: Next rewrites
  loopback hosts to `localhost`, and with `127.0.0.1` the Clerk middleware
  rewrite proxies back to the server in a loop.
- The bundle contains the secrets from `.env.local` and a copy of the dev
  database. Don't distribute the `.app`.
