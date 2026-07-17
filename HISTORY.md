# Prompt History

This file records user prompts and implementation summaries in reverse chronological order. Dates use the project timezone, Europe/Paris.

## 2026-07-17 — Commit, merge, and publish the starter

### Prompt

> great, you can update docs if needed (README, CHANGELOG, HISTORY), create a branch, commit. merge into main and push

### Summary

- Reviewed the installed Next.js 16 form and Server Action guidance required by the repository instructions.
- Updated the project records to cover the completed starter implementation and this delivery request.
- Created the `feature/nextjs-turso-starter` branch for the application and documentation changes.
- Re-ran the project verification suite before committing.
- Committed the verified changes, fast-forward merged the feature branch into `main`, and pushed `main` to `origin`.

## 2026-07-17 — Add project history documentation

### Prompt

> create a CHANGELOG.md file with each commit / merge and details (date descending) as well as an HISTORY.md file with all prompts and summaries (date descending)

### Summary

- Inspected the complete Git history across all branches.
- Found one root commit, `60ba4d9`, and no merge commits.
- Added `CHANGELOG.md` with the commit date, author, type, SHA, change statistics, and implementation details.
- Added `HISTORY.md` with user prompts and outcome summaries ordered newest first.
- Kept uncommitted application changes out of the commit changelog to preserve an accurate distinction between Git history and working-tree work.

## 2026-07-17 — Create the Next.js, Tailwind CSS, and Turso starter

### Prompt

> Let's create a new NextJS + tailwind + Turso db that can be deployed easily on Vercel

### Summary

- Scaffolded a Next.js 16 App Router project with TypeScript, Tailwind CSS 4, ESLint, React 19, and npm.
- Confirmed Turso availability in the live Vercel Marketplace under `tursocloud/database` and followed its official Next.js setup guidance.
- Installed `@libsql/client` and added a server-only Turso database module.
- Added idempotent `notes` table initialization, parameterized reads and writes, and a local SQLite fallback for development.
- Added Server Actions for creating and deleting notes with input validation and route revalidation.
- Replaced the generated page with an accessible, responsive Field Notes interface that supports light and dark color schemes.
- Added metadata, environment documentation, local database ignore rules, a Node.js version requirement, and Vercel deployment instructions.
- Verified ESLint, TypeScript, dependency resolution, and the optimized production build.
- Left Vercel project linking, Turso provisioning, environment pulls, and live database initialization for the deployment step because no project had been linked yet.
- Recorded that the installed global Vercel CLI was 54.6.1 while 56.3.1 was current, and recommended upgrading it.
- Recorded two moderate npm audit findings caused by Next.js 16.2.10's transitive PostCSS pin; no high or critical findings were present.
