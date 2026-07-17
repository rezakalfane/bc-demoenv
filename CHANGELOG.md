# Changelog

This file records every commit and merge in reverse chronological order. Entries are based on Git history; uncommitted working-tree changes are not represented as commits.

## 2026-07-17

### Merge — Integrate the environment dashboard into `main`

- **Date:** 2026-07-17
- **Source:** `feature/environment-dashboard`
- **Target:** `main`
- **Type:** Non-fast-forward feature merge

Integrated the live BigCommerce Dashboard and background rendering fix after lint, TypeScript, production-build, whitespace, and live read-only API verification.

### Commit — Add the live BigCommerce environment dashboard

- **Date:** 2026-07-17 23:52 CEST
- **Author:** Reza Kalfane
- **Branch:** `feature/environment-dashboard`
- **Type:** Feature commit

- Added Dashboard as the authenticated home page and placed it above Notes in the application navigation.
- Moved the private notes page to `/notes` and updated note revalidation to target the new route.
- Added a responsive environment-card grid with three columns on wide screens.
- Added live Channels, Categories, Products, and Variants totals from the BigCommerce REST Management API.
- Added server-only credential decryption, uncached API requests, request timeouts, and bounded environment concurrency.
- Added per-metric error isolation for invalid credentials, missing scopes, invalid store hashes, timeouts, and rate limits.
- Prevented the page background gradient from repeating below its intended area.
- Documented the Dashboard and its required read-only BigCommerce API scopes.

### Merge — Integrate user-scoped BigCommerce environments into `main`

- **Date:** 2026-07-17
- **Source:** `feature/user-scoped-bigcommerce-environments`
- **Target:** `main`
- **Type:** Non-fast-forward feature merge

Integrated the authenticated application shell and encrypted, tenant-scoped BigCommerce environment management after lint, TypeScript, production-build, whitespace, and libSQL isolation verification.

### Commit — Add user-scoped BigCommerce environment settings

- **Date:** 2026-07-17 23:34 CEST
- **Author:** Reza Kalfane
- **Branch:** `feature/user-scoped-bigcommerce-environments`
- **Type:** Feature commit

- Added a shared authenticated application shell with persistent Notes and Settings navigation.
- Added a `/settings` page for creating, editing, and removing named BigCommerce store environments.
- Added tenant-scoped Turso storage for environment names, store hashes, encrypted access tokens, and safe token hints.
- Added AES-256-GCM token encryption with user-bound authenticated data and a dedicated `SETTINGS_ENCRYPTION_KEY` option.
- Added server-side validation, authenticated Server Actions, pending states, success/error feedback, and removal confirmation.
- Documented local and Vercel encryption-key configuration and the multi-tenant storage model.

### Merge — Integrate passwordless multi-tenant notes into `main`

- **Date:** 2026-07-17
- **Source:** `feature/passwordless-multitenant-notes`
- **Target:** `main`
- **Type:** Non-fast-forward feature merge

Integrated the complete Clerk authentication and tenant-isolation feature after lint, TypeScript, production-build, and whitespace verification.

### Commit — Add passwordless authentication and tenant-scoped notes

- **Date:** 2026-07-17 22:49 CEST
- **Author:** Reza Kalfane
- **Branch:** `feature/passwordless-multitenant-notes`
- **Type:** Feature commit

- Added Clerk passwordless sign-up/sign-in with email codes plus optional login-link sign-in and automatic completion in the original browser tab.
- Replaced the unreliable `signUpIfMissing` transfer with Clerk's explicit standard sign-in-or-sign-up flow: unknown identifiers create a normal sign-up and verify through a sign-up-owned email code.
- Restricted access to verified `@bigcommerce.com` and `@commerce.com` accounts in Clerk, the client form, and protected server code.
- Added protected-route middleware, access-denied handling, current-user resolution, and sign-out controls.
- Rendered Clerk email-link query statuses directly on the verification page so `client_mismatch`, expired, and failed links cannot stall on the loading state.
- Detached the login-link long poll from short-lived button loading state so choosing another method cannot leave the form stuck on “Sending…”.
- Invalidated abandoned login-link callbacks when users return to the method selector.
- Scoped note creation, reads, and deletion to the authenticated Clerk user ID.
- Added an idempotent schema migration for `notes.user_id` and a tenant-aware database index while preserving legacy rows without exposing them.
- Provisioned and connected the Clerk Vercel Marketplace resource and enabled its wildcard domain allowlist.
- Documented Clerk email-link settings and their security tradeoff, corporate email-scanner mismatches, local setup, Vercel deployment, and the legacy-note ownership behavior.

### Commit `e58342e` — Build deployable Next.js and Turso starter

- **Date:** 2026-07-17 21:22:23 CEST
- **Author:** Reza Kalfane
- **Branch:** `feature/nextjs-turso-starter`
- **Type:** Feature commit
- **Full SHA:** `e58342e50aeb1837d20dafe82ee37bac462759e5`

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
