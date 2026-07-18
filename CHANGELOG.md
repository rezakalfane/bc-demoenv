# Changelog

This file records every commit and merge in reverse chronological order. Entries are based on Git history; uncommitted working-tree changes are not represented as commits.

## 2026-07-18

### Merge — Integrate realtime snapshot updates into `main`

- **Date:** 2026-07-18
- **Source:** `feature/realtime-snapshot-updates`
- **Target:** `main`
- **Type:** Non-fast-forward feature merge

Integrated publisher attribution, deterministic snapshot/environment ordering, and optional Ably-powered live snapshot publication updates after production-build, TypeScript, lint, dependency, and whitespace verification.

### Commit — Add realtime snapshot publication updates

- **Date:** 2026-07-18
- **Branch:** `feature/realtime-snapshot-updates`
- **Type:** Feature commit

- Displayed the publishing owner's primary Clerk email on cross-user read-only snapshot cards.
- Ordered published snapshot series first by name, remaining series second by name, and Dashboard environments explicitly by name after metric loading.
- Added the official Ably SDK and a Clerk-protected endpoint that issues one-hour, subscribe-only tokens for the published-snapshots channel.
- Published snapshot.published and snapshot.unpublished invalidation events after successful Turso mutations, including automatic unpublication when switching versions.
- Added a debounced Snapshots-page subscriber that refreshes authoritative server data immediately after events.
- Added focus, visibility, and 30-second fallback refreshes for missed events or deployments without Ably configuration.
- Kept `ABLY_API_KEY` server-only and made realtime optional so the application remains functional before provider setup.
- Documented local/Vercel configuration, architecture, prompts, and verification details.

### Merge — Integrate cross-user snapshot publishing into `main`

- **Date:** 2026-07-18
- **Source:** `feature/snapshot-publishing`
- **Target:** `main`
- **Type:** Non-fast-forward feature merge

Integrated owner-controlled snapshot-version publishing, read-only cross-user catalog templates, shared restoration, publication audit history, deletion protection, and consistent compact catalog action styling after TypeScript, lint, production-build, SQL authorization, and whitespace verification.

### Commit — Add cross-user snapshot publishing

- **Date:** 2026-07-18
- **Branch:** `feature/snapshot-publishing`
- **Type:** Feature commit

- Added owner-only Publish and Unpublish controls with a database-enforced limit of one published version per snapshot series.
- Exposed only the published immutable version to other authenticated users in the Snapshots index and channel restore selector.
- Rendered shared templates as read-only, hiding private versions, creation, History, publishing, and deletion while retaining restoration to the viewer's own channels.
- Added blue published borders, icons, badges, and version metadata across snapshot cards and detail pages.
- Added tenant-safe direct-access and restore authorization for published snapshots without exposing unpublished versions.
- Protected published versions and series from deletion until they are unpublished, including disabled UI feedback and server-side validation.
- Added durable Published and Unpublished History events with snapshot version, source, catalog counts, payload size, and timestamps, including automatic unpublication when switching versions.
- Standardized compact action sizing, corrected global form-control font inheritance, and slightly enlarged page-level action rows while keeping dense version-row actions smaller.
- Updated README and prompt History documentation for the complete publishing workflow.

### Merge — Integrate channel catalog and snapshot management into `main`

- **Date:** 2026-07-18
- **Source:** `feature/catalog-snapshot-management`
- **Target:** `main`
- **Type:** Non-fast-forward feature merge

Integrated tenant-scoped channel browsing, durable catalog snapshot/version management, additive cross-channel restoration, background clear/capture/restore operations, progress/history tooling, rate-limit handling, and the compact catalog action interface after lint, TypeScript, production-build, and database query verification.

### Commit — Add channel catalog and snapshot management

- **Date:** 2026-07-18
- **Branch:** `feature/catalog-snapshot-management`
- **Type:** Feature commit

Implemented the complete BigCommerce demo catalog-management workflow described below.

- Made snapshot/channel header actions visibly smaller with 10px labels/icons, 4px vertical and 8px horizontal padding, tight line-height, and compact radii.
- Changed version deletion protection from the latest version to the version currently selected for viewing; any other version, including the latest, can be deleted, and deleted version numbers remain reserved for future captures.
- Added reactive, surface-scoped disabled states for catalog mutation actions: Take/Restore/Clear on an active channel and Create version/Restore/Delete snapshot or older version on an active snapshot, while History and version browsing remain available.
- Added durable snapshot-version deletion audit events to snapshot History, recording the deleted name, version, ID, source environment/channel, catalog counts, and deletion time without exposing deletion controls in History.
- Further reduced snapshot/channel header actions to 11px labels, 12px icons, compact padding, tighter gaps, and smaller corner radii while leaving modal controls and metadata tags unchanged.
- Reworked snapshot and channel headers so titles/subtitles and metadata tags precede a compact right-aligned action row; added consistent 14px action icons, smaller labels, tighter spacing, and retained text on destructive/workflow actions for clarity.
- Fixed Create new version progress so it appears immediately on the open snapshot page, remains synchronized after server refreshes, and automatically navigates to the newly captured snapshot version on completion.
- Added Create new version to snapshot detail pages with a confirmation modal showing the latest version, next version, source environment/channel, catalog counts, and capture date; confirmation queues a persisted capture from the latest version's source.
- Enriched channel catalog History with tenant-resolved snapshot names and versions for capture/restore entries, retaining the snapshot ID as secondary trace data and persisting name/version in new restore results.
- Expanded persisted snapshot progress with the selected channel, category tree, individual category names, channel-assigned product batches, each product name and variant/image counts, supporting metadata, manifest totals, and saved version.
- Added serialized, rate-header-aware snapshot requests with automatic 429 retry and backoff, allowing captures to pause and resume when BigCommerce exhausts its request quota.
- Fixed snapshot capture to resolve product/channel assignments first and only capture products assigned to the selected channel, preventing store-wide snapshots for smaller channels.
- Added tenant-scoped deletion for a complete named snapshot series, with typed confirmation and removal of every retained version.
- Added protected deletion of older snapshot versions from Choose Version; the latest version in each series cannot be deleted.
- Fixed Clear catalog so its Server Action runs before the modal closes, then continues through a server-scheduled persisted operation that survives navigation.
- Fixed Restore Snapshot with the same persisted server-scheduled execution model and durable phase progress.
- Added a fast restore path that preserves existing matched products and only assigns their snapshot categories and destination channel; full catalog data is restored only for newly created products.
- Migrated snapshot capture to the persisted server-scheduled operation pattern while retaining preflight version-conflict confirmation and durable capture progress.
- Added channel- and snapshot-scoped History modals with persisted operation status, timestamps, result details, errors, and snapshot version creation/update records.
- Count existing products assigned to restored channels/categories as updated, including corrected display for earlier fast-restore history entries.
- Filter channel counts, environment listings, and restore destinations to active/prelaunch storefronts, excluding terminated historical channels.
- Added product-level restore progress with product names, creation/reuse mode, variant/image counts, category assignment, channel batches, and final totals.
- Made restores tolerant of product-level errors, recording completed-with-warning details while continuing subsequent items and channel assignments.
- Skip empty metafield synchronization and restrict metafield payloads to writable BigCommerce fields.
- Show queued/running snapshot captures as pending cards with persisted progress on the Snapshots index; cancellation removes the card and redirects snapshot-detail users to the index.
- Drive the progress bar from Turso operation steps and surface persistent BigCommerce failures instead of replaying local-only progress.
- Send the documented category-tree deletion payload, validate partial category failures, and verify assignments/categories after deletion.

### Added

- Added named category/product steps to catalog operation progress bars.
- Added animated catalog-operation indicators to Dashboard environment cards and environment channel listings.
- Added Cancel to the shared operation progress bar and animated activity badges on channel and snapshot titles.
- Unified snapshot, restore, and clear progress into one mutually exclusive operation state visible on channel and snapshot pages.
- Added full-width operation progress rows below channel actions, periodic catalog refresh during active operations, and reload-persistent progress markers.
- Added channel-operation progress indicators and automatic catalog refresh after restore or clear completion.
- Added channel-level snapshot restore with snapshot/version selection, modal confirmation, and destination remapping.
- Added modal snapshot capture from channel pages and a typed-confirmation Clear catalog action that removes channel categories and unassigns products without deleting them.
- Added tenant-scoped snapshot restoration to any active channel in any saved BigCommerce environment, with live destination discovery and server-authoritative validation.
- Added a detailed, accessible restore modal comparing snapshot source and selected destination, catalog counts, destructive effects, typed `RESTORE` confirmation, pending feedback, partial-failure errors, and completion counts.
- Added cross-store reconciliation for category trees, category/product attributes and metafields, brands, tax classes, products, images, variants/options, modifiers, custom fields, bulk pricing, videos, category links, and channel assignments.
- Added stable category-slug and product SKU/slug matching, destination ID remapping, creation of missing records, and preservation of destination categories, products, variants, and channel assignments that are absent from the snapshot.
- Made Dashboard environment names link to dedicated environment detail pages.
- Added tenant-scoped channel lists with channel names, metadata, and a validated primary storefront URL that opens in a new tab.
- Made channel names link to tenant-scoped catalog overview pages.
- Added nested category trees in sticky left panels and responsive product grids.
- Added accessible expand/collapse controls and shareable category links that filter products across the selected category subtree.
- Added optimized BigCommerce CDN product images, plain-text short descriptions, calculated prices, store currency formatting, pagination, and independent catalog error states.
- Added named, tenant-owned catalog snapshots with creation/update metadata, indexed counts, payload sizes, and versioned restoration manifests in Turso.
- Added authenticated full-catalog capture for raw categories, hierarchy, products, variants, options, modifiers, custom fields, pricing rules, videos, image links, metafields, brands, tax classes, and product-category relationships.
- Added Snapshots directly below Dashboard with template cards and snapshot detail pages that reuse expandable category filtering and product browsing.
- Added a channel-level snapshot naming flow with pending/error feedback and redirect to the completed snapshot.
- Added snapshot-name autocomplete across existing user-owned series, showing each latest version and source channel.
- Added a detailed duplicate-name confirmation modal and immutable, automatically incremented snapshot versions, preserving every earlier capture for future rollback.
- Migrated snapshot uniqueness from one row per user/name to one row per user/name/version with atomic next-version allocation.
- Merged catalog-template cards by snapshot name, showing only the latest capture and the total number of retained versions.
- Added a Choose Version modal with tenant-scoped links to inspect every immutable version before selecting one for restoration.
- Added bounded channel-site requests, per-channel URL failure isolation, loading and empty states, and invalid-environment 404 handling.
- Kept Dashboard navigation active on environment detail routes and documented the required BigCommerce channel scope.

### Fixed

- Added post-mutation verification for Clear catalog and faster maximum-size deletion batches.
- Added immediate client-side clearing state for the active channel catalog while category removal and product unassignment run.
- Scoped operation progress and activity badges to their target environment, channel, and snapshot instead of rendering them globally.
- Reduced duplicate progress polling and added 429 backoff for channel catalog reads to avoid rate-limit failures during long operations.
- Added automatic BigCommerce 429 throttling, retry backoff, and inter-batch delays for catalog operations.
- Moved restore and clear progress indicators out of their modals and into the channel page action area above the catalog browser.
- Hardened snapshot image restoration by normalizing CDN URLs, enforcing the image URL length limit, and continuing when an individual image is rejected.
- Made channel catalog product lists authoritative to BigCommerce product-channel assignments, fixing empty channels that previously displayed store products.
- Preserved the destination product's base variant while rebuilding option-bearing variants, preventing base-SKU conflicts during catalog restoration.
- Scoped product-category reconciliation to the destination tree so restoring one channel does not remove category assignments belonging to other channel trees.
- Allowed full catalog-template names to wrap instead of truncating them, and moved the latest-version badge to the card's bottom-right corner.
- Excluded deleted BigCommerce channels from Dashboard totals and environment detail pages.
- Reduced each channel to its primary storefront URL, with the site root URL used only as a fallback.
- Ordered environment channel lists by name in ascending, case-insensitive order.
- Allowed BigCommerce CDN image cache query parameters in the strict Next.js remote-image pattern.
- Made snapshot restoration additive so it never removes destination categories, products, variants, or channel assignments.

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
