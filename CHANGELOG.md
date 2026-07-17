# Changelog

This file records every commit and merge in reverse chronological order. Entries are based on Git history; uncommitted working-tree changes are not represented as commits.

## 2026-07-17

### Commit — Build deployable Next.js and Turso starter

- **Branch:** `feature/nextjs-turso-starter`
- **Type:** Feature commit

Built the initial deployable application and its project documentation.

Details:

- Replaced the generated home page with the responsive Field Notes interface.
- Added Turso/libSQL database access with an idempotent notes schema and parameterized queries.
- Added Server Actions for validated note creation and deletion.
- Added a zero-configuration local SQLite fallback while requiring Turso configuration on Vercel.
- Added environment-variable documentation and Vercel Marketplace deployment instructions.
- Added Node.js runtime requirements and local database ignore rules.
- Added `CHANGELOG.md` for Git history and `HISTORY.md` for prompt history.
- Verified ESLint, TypeScript, and the optimized Next.js production build.

### Commit `60ba4d9` — Initial commit from Create Next App

- **Date:** 2026-07-17 20:56:12 CEST
- **Author:** Reza Kalfane
- **Type:** Root commit
- **Full SHA:** `60ba4d9329f7783df2e4247afa67b84a62a21d80`

Initialized the project from the Create Next App template with Next.js, React, TypeScript, Tailwind CSS, ESLint, and the App Router.

Details:

- Added the initial application shell in `src/app`, including the root layout, home page, global styles, and favicon.
- Added Next.js, TypeScript, PostCSS, ESLint, and package-manager configuration.
- Added the generated dependency lockfile.
- Added starter public assets for Next.js and Vercel.
- Added the initial README and repository guidance files.
- Added ignore rules for dependencies, build output, environment files, and local tooling artifacts.
- Created 19 files with 7,008 inserted lines.

No merge commits are present in the repository history.
