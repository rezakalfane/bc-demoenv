# Changelog

This file records every commit and merge in reverse chronological order. Entries are based on Git history; uncommitted working-tree changes are not represented as commits.

## 2026-07-20

### Merge — Integrate the guided restore wizard

- **Date:** 2026-07-20
- **Source:** `feature/restore-wizard-ux`
- **Target:** `main`
- **Type:** Non-fast-forward feature merge

Integrated the three-step restore wizard, split snapshot/version selectors, published-version markers, and clearer step actions after TypeScript, lint, whitespace, and optimized production-build verification.

### Commit — Add the guided snapshot restore wizard

- **Date:** 2026-07-20
- **Branch:** `feature/restore-wizard-ux`
- **Type:** Feature commit

- Reorganized Snapshot Restore into destination, restore-section, and preflight-review steps with accessible focus movement and a persistent action footer.
- Split channel-page source selection into Snapshot and Version dropdowns, defaulting a changed snapshot to its newest version and identifying published versions.
- Preserved selection-bound preflight invalidation, typed confirmation, pending feedback, and durable Workflow launch behavior.
- Updated README, implementation details, and reverse-chronological prompt History.

### Merge — Integrate durable catalog workflows and restore preflight

- **Date:** 2026-07-20
- **Source:** `feature/durable-catalog-workflows`
- **Target:** `main`
- **Type:** Non-fast-forward feature merge

Integrated durable restore and clear execution, destination restore preflight, pending-state feedback, and validated Workflow diagrams after TypeScript, lint, whitespace, Workflow compiler, and optimized production-build verification.

### Commit — Add durable restore and clear workflows with preflight

- **Date:** 2026-07-20
- **Branch:** `feature/durable-catalog-workflows`
- **Type:** Feature commit

- Replaced request-lifetime restore and clear processing with registered Vercel Workflow runs, persisted run IDs, retryable steps, status reconciliation, and durable cancellation.
- Added read-only destination preflight for resource availability, catalog matching, creates, assignments, warnings, store-wide effects, manual actions, and ambiguous SKU/slug blockers.
- Required a current successful preflight before typed restore confirmation and repeated validation server-side immediately before starting the Workflow.
- Disabled the preflight action while pending and added accessible spinner feedback.
- Added Mermaid diagrams covering all snapshot, restore, and clear Workflow steps, loops, retry limits, and terminal paths, validated with Mermaid CLI 11.16.0.
- Updated README, implementation details, and reverse-chronological prompt History.

## 2026-07-19

### Commit — Separate implementation details and document the database schema

- **Date:** 2026-07-19
- **Branch:** `main`
- **Type:** Documentation commit

- Moved the detailed security, BigCommerce scope, snapshot, configuration, durable-processing, and restoration reference from README into a dedicated `DETAILS.md` document.
- Added a Mermaid entity-relationship diagram for all Turso/libSQL tables, logical relationships, and key uniqueness constraints.
- Validated the database diagram by rendering it with Mermaid CLI and updated reverse-chronological prompt History.

### Merge — Integrate effective Storefront settings restoration

- **Date:** 2026-07-19
- **Source:** `feature/storefront-settings-restore`
- **Target:** `main`
- **Type:** Non-fast-forward feature merge

Integrated effective channel Storefront settings capture and destination override restoration, including safe asset uploads and customer-group remapping, after live `rezakalfane` API validation, TypeScript, lint, whitespace, and optimized production-build verification.

### Commit — Add effective Storefront settings restoration

- **Date:** 2026-07-19
- **Branch:** `feature/storefront-settings-restore`
- **Type:** Feature commit

- Added an opt-in Storefront settings snapshot group for contact details, branding, SEO, robots.txt, product/category display, catalog preferences, inventory rules, search, status messages, and customer privacy.
- Resolved inherited global values during capture and restored them as explicit channel overrides without changing site ownership, domains, routes, checkout URLs, or Makeswift integration configuration.
- Remapped customer-group selections by name and made successful empty V2 responses compatible with both new and existing immutable snapshots.
- Restored image logos and favicons through validated BigCommerce-CDN multipart uploads, retained valid text-logo support, and skipped unsupported empty text-logo mutations.
- Preserved the destination contact email, generated prelaunch password, global-only search configuration, and non-writable launch state.
- Verified every writable JSON settings endpoint, customer privacy update, and favicon upload against `rezakalfane` channel `1881648` with successful HTTP 200 responses.
- Updated README operational guidance and reverse-chronological prompt History.

### Merge — Integrate default tax-zone restoration fix

- **Date:** 2026-07-19
- **Source:** `fix/default-tax-zone-restore`
- **Target:** `main`
- **Type:** Non-fast-forward bug-fix merge

Integrated BigCommerce default tax-zone payload sanitization and resilient tax-rate mapping after official API review, live `rezakalfane` validation, TypeScript, lint, whitespace, and optimized production-build verification.

### Commit — Sanitize default tax-zone restoration

- **Date:** 2026-07-19
- **Branch:** `fix/default-tax-zone-restore`
- **Type:** Bug-fix commit

- Removed the immutable nested shopper targeting and enabled status from default tax-zone update requests while retaining ordinary-zone locations and customer groups.
- Matched the default destination zone by its immutable ID with a name fallback and retained its mapping before best-effort metadata updates so tax rates can still reconcile.
- Confirmed the sanitized payload against the authorized `rezakalfane` environment with a successful BigCommerce `200` response for zone `1`.
- Updated README tax-restoration guidance and reverse-chronological prompt History.

### Merge — Integrate safe configuration and localization restoration

- **Date:** 2026-07-19
- **Source:** `fix/restore-portability-localization`
- **Target:** `main`
- **Type:** Non-fast-forward bug-fix merge

Integrated destination-safe configuration restoration, durable manual-action history, channel-scoped locale defaults, and independent catalog-translation mapping after live BigCommerce request validation, TypeScript, lint, whitespace, and optimized production-build verification.

### Commit — Harden configuration and localization restoration

- **Date:** 2026-07-19
- **Branch:** `fix/restore-portability-localization`
- **Type:** Bug-fix commit

- Created or enabled missing destination currencies while preserving unrelated channels' existing currency visibility and assigning the captured currencies only to the restored channel.
- Logged a safe manual Payments channel-visibility action instead of attempting private Control Panel payment-profile APIs.
- Made captured Channel & storefront data inspect-only to protect destination Makeswift, routing, domains, URLs, and checkout ownership.
- Reset stale successful Restore modal state whenever a new restore session opens.
- Captured the effective source channel country, restored it only to the destination channel, added missing locales without deleting existing ones, and skipped redundant default-locale updates.
- Mapped product translations by SKU/slug and category translations by path/hierarchy independently from Catalog restoration, fixed GraphQL payload parsing, and surfaced detailed permission errors.
- Verified the destination mapping for all 51 products and 26 categories in the affected `rezakalfane` restore; the live translation replay remains gated by the destination API token's Content modify (`store_content`) permission.
- Updated README operational guidance and reverse-chronological prompt History.

### Merge — Integrate destination-scoped shipping assignments

- **Date:** 2026-07-19
- **Source:** `fix/shipping-destination-channel`
- **Target:** `main`
- **Type:** Non-fast-forward bug-fix merge

Integrated destination-scoped shipping-method restoration after TypeScript, lint, whitespace, and optimized production-build verification.

### Commit — Scope restored shipping methods to the destination channel

- **Date:** 2026-07-19
- **Branch:** `fix/shipping-destination-channel`
- **Type:** Bug-fix commit

- Assigned newly created shipping methods only to the channel selected for restoration.
- Preserved existing method-to-channel assignments and appended only the destination channel with deduplication.
- Prevented shipping restores from automatically exposing methods to unrelated storefront channels.
- Updated README behavior guidance and reverse-chronological prompt History.

### Merge — Integrate snapshot portability and configuration-restoration fixes

- **Date:** 2026-07-19
- **Source:** `fix/snapshot-portability-polish`
- **Target:** `main`
- **Type:** Non-fast-forward bug-fix merge

Integrated inline snapshot-series naming, manifest-aware restore controls, B2B channel gating, related-product preservation, and hardened cross-store configuration reconciliation after live BigCommerce shipping verification, TypeScript, lint, whitespace, and optimized production-build checks.

### Commit — Harden snapshot portability and shipping restoration

- **Date:** 2026-07-19
- **Branch:** `fix/snapshot-portability-polish`
- **Type:** Bug-fix commit

- Added accessible inline snapshot-series renaming with uniqueness enforcement, History audit events, and realtime publication refreshes.
- Limited B2B capture to channels explicitly enabled in B2B Edition and limited restore choices to configuration groups present in the selected immutable manifest.
- Ordered restore candidates by name and descending version, identified published versions, and preserved BigCommerce automatic related-product behavior.
- Enabled destination currencies when possible, remapped price-list records and catalog translations, corrected inventory/theme capture boundaries, and sanitized tax payloads.
- Reconciled shipping zones and methods using writable request models, reused the immutable global zone, assigned methods to every live storefront, and retained detailed V2 validation errors.
- Verified the resulting United States and global flat-rate methods, rates, enabled state, and four-channel assignments against the authorized `rezakalfane` environment.

### Merge — Integrate snapshot configuration, B2B demo data, and scoped completion navigation

- **Date:** 2026-07-19
- **Source:** `feature/snapshot-configuration-b2b`
- **Target:** `main`
- **Type:** Non-fast-forward feature merge

Integrated inspectable optional configuration capture, categorized restore controls, B2B Edition demo-data portability, and route-scoped snapshot completion navigation after TypeScript, lint, whitespace, and optimized production-build verification.

### Commit — Add portable snapshot configuration and B2B demo data

- **Date:** 2026-07-19
- **Branch:** `feature/snapshot-configuration-b2b`
- **Type:** Feature commit

- Captured inspectable channel, storefront, checkout, customer, pricing, shipping, tax, inventory, localization, theme, and script configuration with resource-level warnings.
- Added opt-in categorized configuration restoration with store-wide impact guidance and safe reconciliation for portable resources.
- Added B2B Edition capture for permissions, roles, Companies, users, addresses, hierarchies, shopping lists, quotes, orders, invoices, payments, attachments, sales representatives, and extra-field definitions.
- Restored writable B2B demo records additively with source-to-destination ID mapping while retaining read-only or notification-sensitive records as inspectable data and explicit warnings.
- Added a protected, on-demand Snapshot settings inspector with secret redaction for owned and published versions.
- Scoped automatic navigation to a completed snapshot version to the exact channel or snapshot route that launched its capture.
- Updated README scope, portability, notification, publication, and API-boundary guidance plus reverse-chronological prompt History.

### Commit — Add application overview screenshot to documentation

- **Date:** 2026-07-19
- **Branch:** `main`
- **Type:** Documentation commit

- Added a full-resolution BigCommerce Demo Environment Manager screenshot under `docs/images`.
- Displayed the screenshot near the top of the README to provide an immediate visual overview of the application.
- Recorded the documentation request in prompt History.

### Merge — Integrate the Workflow sandbox hotfix into `main`

- **Date:** 2026-07-19
- **Source:** `fix/workflow-sandbox-boundary`
- **Target:** `main`
- **Type:** Non-fast-forward hotfix merge

Integrated the corrected Workflow module boundary and durable-run status synchronization after production run inspection, TypeScript, lint, whitespace, optimized production-build, step registration, and generated flow-bundle verification.

### Commit — Keep Node dependencies out of snapshot Workflow orchestration

- **Date:** 2026-07-19
- **Branch:** `fix/workflow-sandbox-boundary`
- **Type:** Bug-fix commit

- Fixed production snapshot runs failing before their first step with `ReferenceError: require is not defined` from the libSQL native loader.
- Separated deterministic orchestration, Node.js catalog steps, and server-side run dispatch so Turso, sqlite3, and native modules remain outside the Workflow VM bundle.
- Reconciled persisted catalog operations with durable run status so early platform failures are displayed instead of remaining queued.
- Made catalog cancellation cancel the underlying Workflow run as well as its Turso operation and staging state.
- Documented the production evidence and verified that the generated flow bundle contains no Node-native database dependencies.

### Merge — Integrate durable snapshot capture into `main`

- **Date:** 2026-07-19
- **Source:** `fix/durable-snapshot-workflow`
- **Target:** `main`
- **Type:** Non-fast-forward hotfix merge

Integrated resumable Vercel Workflow snapshot capture after TypeScript, lint, whitespace, optimized production-build, generated endpoint, and local Workflow accessibility verification.

### Commit — Make snapshot capture durable on Vercel

- **Date:** 2026-07-19
- **Branch:** `fix/durable-snapshot-workflow`
- **Type:** Bug-fix commit

- Replaced the single five-minute server invocation used by snapshot capture with a durable Vercel Workflow that survives browser closure, navigation, deployments, and individual function limits.
- Split captures into retryable 30-product steps, persisted product batches and exact progress in Turso, and finalized snapshot versions atomically and idempotently.
- Added stale-operation recovery, cancellation cleanup, and Workflow run identifiers while preserving the existing durable operation UI and snapshot-name uniqueness controls.
- Exposed Workflow's generated internal endpoints outside Clerk protection and documented their role and Vercel zero-configuration behavior.
- Kept restore and clear operations unchanged while limiting this reliability migration to snapshot capture.

### Merge — Integrate snapshot capture uniqueness into `main`

- **Date:** 2026-07-19
- **Source:** `fix/snapshot-capture-uniqueness`
- **Target:** `main`
- **Type:** Non-fast-forward hotfix merge

Integrated database-enforced prevention of concurrent, same-name snapshot captures after TypeScript, lint, whitespace, optimized production-build, and concurrent libSQL verification.

### Commit — Prevent concurrent same-name snapshot captures

- **Date:** 2026-07-19
- **Branch:** `fix/snapshot-capture-uniqueness`
- **Type:** Bug-fix commit

- Added normalized snapshot-name operation keys and a partial unique database index allowing only one queued or running capture per user and name.
- Protected both channel Take snapshot and snapshot Create new version entry points from duplicate submissions across tabs, browsers, and concurrent server requests.
- Preserved deliberate snapshot version creation after the active capture completes and returned actionable conflict messages while a capture is active.
- Normalized excess whitespace in snapshot names and documented the reported modal race in prompt History.

## 2026-07-18

### Merge — Integrate the Ably cleanup hotfix into `main`

- **Date:** 2026-07-18
- **Source:** `fix/ably-subscription-cleanup`
- **Target:** `main`
- **Type:** Non-fast-forward hotfix merge

Integrated safe Ably subscription teardown for the Snapshots page after TypeScript, lint, whitespace, and optimized production-build verification.

### Commit — Handle Ably subscription cleanup safely

- **Date:** 2026-07-18
- **Branch:** `fix/ably-subscription-cleanup`
- **Type:** Bug-fix commit

- Fixed the React Strict Mode race that could close Ably while its asynchronous channel subscription was still attaching.
- Marked the effect as disposed before teardown so the expected `Connection closed` rejection no longer triggers the Next.js development error overlay.
- Prevented scheduled refreshes after unmount and kept unexpected realtime connection failures non-fatal while retaining focus, visibility, and periodic fallback refreshes.
- Documented the reported failure and implementation summary in prompt History.

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
