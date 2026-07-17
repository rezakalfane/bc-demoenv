# Field Notes

A deployable Next.js 16 starter with the App Router, Tailwind CSS 4, and Turso/libSQL. The example app reads from Turso in a Server Component and writes through Server Actions.

## Local development

Node.js 20.19 or newer is required. No database account is needed for a first run: without environment variables, the app creates `local.db` in the project directory.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

To develop against an existing Turso database instead, create `.env.local` from `.env.example` and set both values:

```bash
cp .env.example .env.local
```

## Deploy to Vercel with Turso

The current Vercel Marketplace slug is `tursocloud/database`.

```bash
npx vercel@latest link
npx vercel@latest integration add tursocloud/database
npx vercel@latest env pull .env.local --yes
npx vercel@latest deploy
```

The integration injects `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` into the linked Vercel project. The app creates its `notes` table on the first request.

For a production deployment after the initial preview is verified:

```bash
npx vercel@latest deploy --prod
```

## Useful commands

```bash
npm run dev     # start the local development server
npm run lint    # run ESLint
npm run build   # create a production build
npm run start   # serve the production build
```

## Project records

- [`CHANGELOG.md`](./CHANGELOG.md) records commits and merges in reverse chronological order.
- [`HISTORY.md`](./HISTORY.md) records user prompts and implementation summaries in reverse chronological order.
