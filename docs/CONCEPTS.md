# Concepts

## What an Environment is

An **Environment** (`BIGCOMMERCE_ENVIRONMENTS`) is a saved connection to a real BigCommerce store, owned by a single tenant (Clerk user). It's the thing snapshots are captured from and restored into.

### Schema

```
BIGCOMMERCE_ENVIRONMENTS
  id                      INTEGER PK
  user_id                 TEXT
  name                    TEXT UK
  store_hash              TEXT
  access_token_encrypted  TEXT
  access_token_hint       TEXT
  created_at / updated_at TEXT
```

### Key characteristics

- **Identity**: An environment name is case-insensitively unique per user — it's just a friendly label over a `store_hash` + encrypted access token pair.
- **Credentials**: The BigCommerce access token is encrypted with AES-256-GCM at rest. Only the last four characters (`access_token_hint`) are ever shown in the UI; the app binds every read/update/delete to the owning Clerk user ID so one user can never touch another's environment.
- **Access scopes**: What you can do with an environment depends on its OAuth scopes:
  - Catalog-only dashboard metrics + snapshot **capture**: `Products: read-only` + `Channel Settings: read-only` (plus more read scopes for optional config sections like Sites & Routes, Themes, B2B).
  - Catalog **restore**: needs `Products: modify`, plus matching modify scopes per selected config section (e.g., `Content: modify` for localization, `B2B Edition: modify` for B2B).
- **Relationships** (from the ER diagram):
  - `BIGCOMMERCE_ENVIRONMENTS` is the **source for** `CATALOG_SNAPSHOTS` (snapshot rows store `source_environment_id`/`name` denormalized, so a snapshot survives even if the source environment is later deleted — no FK constraint).
  - Has cached **metrics** (`BIGCOMMERCE_ENVIRONMENT_METRICS`) — product/category/channel counts refreshed from BigCommerce and shown immediately from cache (cached-first rendering) on the Dashboard.
  - Is **targeted by** `CATALOG_OPERATIONS` (capture/restore/clear jobs) and `CATALOG_SCHEDULES` (automated recurring jobs).
  - Can be **favorited** (`FAVORITES`, keyed by the environment's DB id).
- **Channels**: Each environment can have multiple BigCommerce **channels** underneath it (storefronts) — operations, restores, and schedules target a specific `environment_id` + `channel_id` pair, not just the environment.
- **Diagnostics**: There's an access-diagnostics feature (`environment_access_diagnostics`) that tests the stored credentials/scopes against BigCommerce and reports what's actually usable.
- **Lifecycle**: Environment creation/deletion is audited (`application_events`/Operations feed). Deleted environments are excluded from totals, navigation, and restore destinations, but historical snapshots/audit rows referencing them remain intact since there's no hard FK.

In short: an **Environment** = a tenant's stored, encrypted connection to a BigCommerce store, acting as the source for snapshot captures and the destination for restores, with cached metrics and scope-gated capabilities.

## What a Snapshot is

A **Snapshot** is an immutable, point-in-time capture of a BigCommerce store's catalog data (products, categories, and related resources). It lets you save the state of one environment's catalog and later restore it — to the same environment or a different one.

### Key model details

- **Named series with versions**: Snapshots are identified by `(user_id, name, snapshot_version)`. The `name` is a series (case-insensitively unique per user), and each save appends a new immutable `snapshot_version` — like git tags on a branch. Only one version per series can be "published" at a time.
- **Immutability**: Once captured, a snapshot version doesn't change. There are no SQL foreign-key constraints tying it to its source environment, so a snapshot (and its audit trail) survives deletion of the environment it came from.
- **Capture flow**: Capturing is a durable, checkpointed operation:
  - `CATALOG_SNAPSHOT_CAPTURE_STATE` tracks per-operation progress (environment, channel, etc.)
  - `CATALOG_SNAPSHOT_CAPTURE_PRODUCTS` stages captured products page-by-page (`operation_id, product_index`)
  - This uses Turso/libSQL checkpoints so a long-running capture can resume rather than restart if interrupted (see the "Durable Catalog Processing with Turso Checkpoints" concept, which the snapshot workflow implements via `initializeSnapshotStep` / `failSnapshotStep`).
- **Restoring**: A snapshot (specific version) can be restored back into an environment. Restore supports selective **configuration groups** (`parseSnapshotRestoreGroups`) so you can restore only certain parts of the catalog rather than everything.
- **Diffing**: There's a snapshot diff mechanism (`diffCatalogSnapshotManifests`) to compare two snapshot versions and see what changed.
- **Scheduling**: `CATALOG_SCHEDULES` can target a snapshot series to automatically capture new versions or restore on a cadence (daily/weekly, timezone-aware), dispatched via Vercel Cron (or a local dev scheduler).
- **Tags & favorites**: Snapshot series can have up to 12 tags (`CATALOG_SNAPSHOT_TAGS`), and users can favorite a snapshot series (favorite key survives new versions since it's keyed by owner + normalized series name, not by individual version).
- **Events**: `CATALOG_SNAPSHOT_EVENTS` logs an audit trail per snapshot (event type, version, payload).

In short: a **Snapshot** = a versioned, immutable backup of a store's catalog, capturable/restorable/diffable/schedulable, with durable resumable capture and safe cross-environment reuse.

## What a Restore is

A **Restore** is the operation that writes a captured snapshot version back into a live BigCommerce environment + channel — either the same one it was captured from or a different one entirely.

### Key characteristics

- **Version-pinned**: a restore targets a specific snapshot version, and a Schedule retains its selected version + groups so a later publish elsewhere can't silently change what gets restored.
- **Selective via restore groups**: Catalog (products/categories) is always included; every other section is an opt-in configuration group (Storefront settings, Checkout, Pricing & currencies, Shipping, Tax, Inventory, B2B Edition, Localization) — see "What Restore Groups / Configuration Groups are".
- **Additive, not destructive**: restore reconciles by stable identity — categories by URL slug/path, products by SKU/slug, zones by name — adding/updating rather than deleting, so unrelated existing destination data is preserved.
- **Cross-channel and cross-store**: identity matching by slug/SKU (not BigCommerce IDs) means a snapshot captured from one channel — even in a different store — restores cleanly into another channel.
- **Preflighted**: a Snapshot → Destination comparison runs first (`preflightSnapshotRestore`), then the durable restore Operation is created (`restoreSnapshot`), with progress tracked like any other catalog operation.
- **Safe by design**: secrets (domains, SSL, carrier/payment/tax credentials) are never copied; contact email, sites, and routes stay inspect-only; anything that can't be safely applied is recorded in the manifest and surfaced as a restore warning (e.g. payment gateway channel visibility, finished manually via the **Payments → Manage Channel Visibility** deep link).
- **Audited**: restore events are logged in the Operations audit feed alongside capture, publish, rename, and deletion.

In short: a **Restore** = a preflighted, group-selective, additive reconciliation of a pinned snapshot version into a destination channel — safe against deleting existing data, explicit about anything it can't apply.

## What an Operation is

A **catalog Operation** (`CATALOG_OPERATIONS`) is the persisted, tenant-owned record of a single unit of catalog work — capture, restore, clear, or Clear & Restore. It's the row that ties a background Workflow run to something the UI can show progress, results, and history for.

### Schema

```
CATALOG_OPERATIONS
  id               INTEGER PK
  user_id          TEXT
  kind             TEXT
  environment_id   INTEGER
  channel_id       INTEGER
  snapshot_id      INTEGER
  operation_key    TEXT
  status           TEXT
  current_step     TEXT
  step_index       INTEGER
  total_steps      INTEGER
  payload_json     TEXT
  result_json      TEXT
  error            TEXT
  workflow_run_id  TEXT
  created_at / updated_at TEXT
```

### Key characteristics

- **One row per job**: Every capture, restore, clear, or refresh (Clear & Restore) is a single Operation row, regardless of how many durable Workflow steps it takes internally — even Clear & Restore's two phases (clear, then restore) share one operation, one Workflow run, one progress surface, one notification, and one audit result.
- **Exclusivity**: Only one queued or running operation can exist for a given `(user_id, kind, operation_key)` tuple — a partial unique index rejects a second concurrent job targeting the same action/destination, which is what makes concurrent schedule dispatchers and manual "Run now" safe.
- **Progress tracking**: `current_step`, `step_index`, and `total_steps` back the visual trace/progress bar; the trace also infers macro stages (e.g. "Unassign products", "Remove channel categories") from checkpoint cursors and progress messages, not just raw Workflow step names.
- **Linked to a Workflow run**: `workflow_run_id` connects the operation to its underlying Vercel Workflow execution, so the app can reconcile state after navigation, browser closure, Function timeout, or deployment restarts.
- **Recovery**: An operation whose Workflow run is missing or orphaned (e.g. after a local dev-server restart) can be atomically claimed for recovery, cancelling the stale run and continuing from the last Turso checkpoint under the same operation row.
- **Terminal states surface everywhere**: Completed/failed/cancelled operations drive toast notifications, the sidebar notification inbox, and the Operations/Workflows pages, and link back to the affected channel or new snapshot.
- **Audit trail**: The Operations page merges `catalog_operations`, `catalog_snapshot_events`, and `application_events` into one tenant-scoped feed covering capture, restore, clear, rename, publish/unpublish, deletion, and environment creation/deletion.

In short: an **Operation** = the durable, resumable database record of one catalog job (capture/restore/clear/refresh), providing the status, progress, and audit trail that surfaces across Dashboard, Environment, Channel, Snapshot, Operations, and Workflows pages.

## What a Workflow is

A **Workflow** is the underlying durable execution engine (Vercel Workflow / `"use step"`) that actually runs catalog operations step-by-step, with automatic checkpointing so long-running jobs survive interruptions.

### Key characteristics

- **Durable, retryable steps**: Snapshot capture uses `catalogSnapshotWorkflow`; restore, clear, and Clear & Restore are the three branches of `catalogOperationWorkflow`, sharing common initialization (`initializeSnapshotStep` / `initializeCatalogOperationStep`) and failure (`failSnapshotStep` / `failCatalogOperationStep`) steps.
- **Checkpointing**: Large snapshot captures persist their channel/category-tree seed first, then checkpoint retryable batches (10 categories / 30 products at a time) in Turso before an atomic finalization transaction creates the immutable snapshot version. Restore checkpoints each selected catalog/configuration group as a retryable step; clear re-reads remaining channel assignments/categories on retry.
- **Resilience**: Closing the browser, navigating away, an individual Function timeout, or a deployment does not discard completed batches — the Workflow resumes from its last Turso cursor. In local dev, if a run's runtime metadata is orphaned (e.g. after a `next dev` restart), the stale run is atomically claimed for recovery and a replacement run continues the same operation.
- **One run per operation**: Each `CATALOG_OPERATIONS` row stores its `workflow_run_id`, so the API can reconcile run state independent of the browser session. Cancellation stops the registered Workflow run and updates that same operation row.
- **Observability**: The Workflows subpage is a read-only projection over tenant-owned operations plus available Vercel Workflow runtime metadata — search, filter, sort, refresh, cancel, retry (as a new run), copy run ID, and jump back to the affected resource. Application status remains authoritative if archived runtime metadata is gone.
- **Not every action is a Workflow**: Database sync (Turso ⇄ local SQLite mirror) is an explicit, developer-invoked bounded transaction from Settings and intentionally has no Workflow run — it's recorded as a terminal "Database sync" row in Operations instead.

In short: a **Workflow** = the durable, checkpointed, resumable execution behind a catalog Operation — it's *how* the work actually runs; the Operation row is the tenant-facing record *of* that work.

## What the Scheduler is

The **Scheduler** is the recurring-automation layer that dispatches catalog snapshot/restore/refresh actions on a cadence, without a person clicking a button each time.

### Schema

`CATALOG_SCHEDULES` stores, per tenant-owned schedule: a descriptive (non-unique) name, one channel target (`environment_id` + `channel_id`), an action, a daily or weekly local-time cadence with IANA timezone, an optional immutable snapshot version, selected restore groups, and next/last dispatch metadata.

### Key characteristics

- **Same patterns as manual restore**: The schedule editor reuses the same favorite-aware environment/channel and snapshot/version pickers as manual restore. Snapshot schedules append a new immutable version to their named series on each run; restore/Clear & Restore schedules retain the chosen version and configuration groups so a later publish elsewhere doesn't silently change what the schedule restores.
- **Dispatch mechanism**: In production, Vercel Cron calls `/api/scheduler/tick` (once/day by default on Hobby, authenticated via server-only `CRON_SECRET`; Pro/Enterprise can go to `* * * * *` for minute-level dispatch). In local development, a per-user browser dispatcher can run every minute or once a day — its enablement is independent of both the saved schedule state and the production dispatcher.
- **Concurrency safety**: Multiple dispatchers (cron + browser tabs) are safe to run concurrently — each attempts an atomic compare-and-update claim of the due timestamp, so only one advances a given schedule occurrence. The `CATALOG_OPERATIONS` partial unique index then blocks a second queued/running operation for the same action key and destination even if a claim race slips through.
- **Manual override**: "Run now" reuses the same dispatch path without touching the saved cadence. Pause/resume returns immediately and recalculates the next occurrence on resume. Editing or deleting a schedule never deletes its historical Operations/Workflow records.
- **Execution**: Every dispatched schedule becomes a normal durable Workflow-backed `CATALOG_OPERATION` (capture, restore, clear, or refresh) — the Scheduler is just the trigger; the actual work runs through the same Workflow/Operation machinery as a manually-initiated action, so failures show up in Operations/Workflows the same way.
- **UI**: The Scheduler page shows the user's current timezone clock and warns development users if their local dispatcher is disabled, using a cached-first rendering path (saved schedules/snapshots/environment names render immediately from libSQL, then live BigCommerce environment/channel data loads in the background).

In short: the **Scheduler** = the cron-driven trigger for recurring catalog jobs — it decides *when* a capture/restore/refresh should run; once due, it creates a normal Workflow-backed Operation just like a manual action would.

## What a Channel is

A **Channel** is a storefront within a BigCommerce Environment — the actual destination (or source) that catalog data is captured from or restored into. An Environment can have many channels (e.g. a default storefront plus additional sales channels), and most catalog work is scoped to one specific `environment_id` + `channel_id` pair, not the environment as a whole.

### Key characteristics

- **Not stored locally as its own table**: unlike Environments, channels aren't persisted in a `BIGCOMMERCE_CHANNELS` table — they're discovered live from BigCommerce (`loadEnvironmentChannels`) and referenced by ID wherever they matter (`CATALOG_OPERATIONS.channel_id`, `CATALOG_SCHEDULES.channel_id`, snapshot `source_channel_id`/`source_channel_name`, favorite keys, etc.).
- **Scope of capture and restore**: Product capture resolves BigCommerce channel *assignments* first, then loads only the products assigned to that channel. Configuration capture/restore (storefront settings, shipping, currencies, localization) is likewise channel-scoped — e.g. storefront settings resolve inherited global values into explicit destination-channel overrides.
- **Cross-channel and cross-store restore**: Restore is channel-aware but not channel-locked — it maps categories by URL slug and products by SKU/slug so a snapshot captured from one channel (even in a different store) can be restored into a different destination channel.
- **Favorited and browsable**: Channels can be favorited (the favorite key combines environment ID + BigCommerce channel ID), listed under an environment's channel list, and browsed like a live product catalog (channel pages show live products/categories the same way snapshot pages show captured ones).
- **Deleted channels**: Excluded from totals, navigation, and restore destinations — but historical operations/snapshots referencing a deleted channel's ID/name remain in the audit trail.
- **Channel type affects capabilities**: Some configuration APIs are unavailable or inapplicable for certain channel types (e.g. Stencil theme access doesn't apply to a Catalyst channel); these are recorded as warnings rather than treated as broken credentials.
- **Payment visibility caveat**: BigCommerce restricts payment-profile channel associations to its authenticated Control Panel rather than public store-token APIs, so a restored channel's payment gateway visibility must be finished manually via a linked **Payments → Manage Channel Visibility** deep link.

In short: a **Channel** = a specific storefront under an Environment — the unit that captures, restores, schedules, and operations actually target, discovered live from BigCommerce rather than stored as its own row.

## What a Publication is

**Publication** is the opt-in mechanism that makes a specific snapshot version visible and usable by other authenticated users of the application, not just its owner.

### Key characteristics

- **One published version per series**: Publication is limited to a single version per owner/series — publishing a new version implicitly supersedes the previous published one for that series.
- **Reversible**: Unpublishing immediately removes cross-tenant access; it doesn't delete the snapshot, just the shared visibility.
- **Viewer capabilities are limited**: Published viewers can browse the snapshot, use its shared tags and localization status for filtering, and (for B2B) see its captured demo data — but they cannot edit tags, rename, or otherwise mutate someone else's snapshot.
- **Demo-safety requirement**: Because publishing shares captured data (including B2B Companies, users, addresses, quotes, etc.) with every other application user, published versions must contain only demo-safe identities and business records — this is a content responsibility of the publisher, not something the system sanitizes automatically.
- **Audited**: Publish/unpublish actions are recorded as their own event types in the Operations audit feed (`catalog_snapshot_events` / `application_events`), alongside capture, restore, rename, and deletion.

In short: **Publication** = the per-series, single-version, reversible switch that turns a private snapshot into a shared, read-only, cross-tenant resource.

## What an Access Diagnostic is

**Access Diagnostics** is a self-service tool that tests a saved Environment's stored credentials and OAuth scopes against the real BigCommerce store, without ever exposing the decrypted token.

### Key characteristics

- **Server-only credential use**: Diagnostics reuse the same tenant-scoped, server-only credential lookup as everything else — the decrypted access token never reaches the browser.
- **Bounded, read-only probes**: **Test access** sends bounded, read-only requests against representative Catalog, Channels, Sites, storefront settings, Customers, Content, Shipping, Tax, Inventory, Pricing, Themes, and B2B Edition endpoints.
- **Scope inference from error codes**: BigCommerce access tokens don't return a trustworthy scope-list response, so the report infers *missing read scopes* from `403` responses, distinguishes invalid credentials from rate limiting, and lists `404`/unsupported resources separately as "unavailable for this store or channel type" rather than "broken."
- **Channel-type awareness**: APIs that are simply inapplicable to a given channel type (e.g. Stencil theme access on a Catalyst channel) don't make an otherwise valid credential look broken.
- **Write is never tested**: Modify/write permissions are explicitly never exercised — restore and clear capabilities are reported as **Write not tested**, with the specific modify scopes they'd require named instead.

In short: an **Access Diagnostic** = a read-only, scope-inferring health check for an Environment's stored BigCommerce credentials — it tells you what will and won't work before you attempt a real capture or restore.

## What Favorites are

**Favorites** are private, per-user presentation metadata that let a user star Environments, Channels, or Snapshot series for quicker access — they carry no access implications of their own.

### Key characteristics

- **Composite key**: `(user_id, resource_type, resource_key)`. The `resource_key` is built differently per type so favorites survive change:
  - Environment keys use the tenant-owned database ID.
  - Channel keys combine environment ID + BigCommerce channel ID.
  - Snapshot keys combine the owner's Clerk ID with the *normalized series name* (not a specific version ID), so a favorite survives new immutable versions being added to that series. Snapshot rename/deletion reconciles this key for every viewer who favorited it.
- **Ownership-checked on write**: Every favorite lookup/toggle includes the current Clerk user ID, and the Server Action verifies ownership of the environment/channel, or current access to an owned/published snapshot, before accepting the mutation.
- **Never grants access**: Favorite status is purely presentational — it never grants access to a resource that isn't otherwise visible to that user (e.g. an unpublished snapshot you don't own can't be "un-hidden" by favoriting it).
- **Used across pickers**: The same favorite-aware environment/channel/snapshot picker pattern is reused in manual restore and in the Scheduler editor, so frequently used destinations/sources surface first.

In short: **Favorites** = a private, per-user "pin" on an Environment/Channel/Snapshot series, keyed to survive renames and new versions, that never expands what a user can actually access.

## What Restore Groups / Configuration Groups are

**Restore groups** (a.k.a. **configuration groups**) are the selectable sections of a snapshot restore beyond the core product/category catalog — each group restores a distinct slice of store configuration, and each can be included or skipped independently.

### The groups

Restore starts with **Catalog** always selected, plus these opt-in "safe configuration" groups:

- **Storefront settings** — contact info, logos/favicon, SEO/robots.txt, product/category display, catalog preferences, inventory rules, search, status messages, customer privacy. Resolves inherited global values into explicit destination-channel overrides. Contact email, channel properties, metafields, sites, and routes remain inspect-only (never restored) to protect the destination's own identity/integrations.
- **Checkout & customer experience**
- **Pricing & currencies** — creates/enables missing currencies globally, then assigns enabled/default currencies to the destination channel only; payment-profile channel visibility can't be restored via API and becomes a manual action (linked to **Payments → Manage Channel Visibility**).
- **Shipping** — reconciles zones by name, creates/updates methods with rates/enabled state, assigns new methods to the destination channel while preserving existing methods' other channel assignments.
- **Tax** — maps BigCommerce's immutable default zone to destination zone `1`, restores editable display settings only; default-zone status/locations/customer-groups are BigCommerce-owned and untouched.
- **Inventory & locations**
- **B2B Edition** — store-wide; additively reconciles permissions/roles, Companies, users, addresses, hierarchy, shopping lists. Quotes, invoices, payments, attachment binaries, and extra-field definitions are captured for audit but flagged with restore warnings since they can't be safely recreated.
- **Localization & presentation** — restores channel default country and captured locales (additively, respecting BigCommerce's 5-locale-per-channel limit) plus product/category translations, mapped independently by SKU/slug so it can be restored standalone after Catalog already exists.

### Shared rules

- **Additive, not destructive**: restore groups reconcile by stable identity (names, SKUs/slugs, generated IDs) and add/update — they don't delete unrelated existing destination data.
- **Secrets never copied**: domains, SSL ownership, carrier/payment/tax-provider credentials, and other secrets are never restored; anything mapping-sensitive that can't be applied safely is recorded in the manifest and surfaced as a restore warning instead.
- **Chosen at restore/schedule time**: the selected set of groups is preflighted (a Snapshot → Destination comparison) before the durable restore Operation is created, and a Schedule retains its selected version + groups so a later publish elsewhere doesn't silently change what gets restored.

In short: **Restore/Configuration groups** = the opt-in, independently-selectable sections of a snapshot restore (Catalog is mandatory; Storefront, Checkout, Pricing, Shipping, Tax, Inventory, B2B, Localization are opt-in) — each reconciles additively and records anything it can't safely apply as a warning.

## What Snapshot Diff is

**Snapshot Diff** is the server-side comparison of two retained versions within the same snapshot series, without sending their (potentially multi-megabyte) manifests to the browser.

### Key characteristics

- **Same-series only**: the authenticated Server Action reloads both versions through the existing tenant/publication access predicate and confirms they share the same owner and case-insensitive series name before diffing.
- **Directional**: the diff is computed source-version → destination-version, i.e. "what changed going from A to B."
- **Stable identity matching**: categories are matched by stable path, products by SKU/slug, variants by SKU/option values, images by URL, and metafields by namespace/key — so a diff reflects real content changes, not just record reordering.
- **Scope**: covers categories, products (with child collections like variants/images compared separately), category/product/variant metafields, and captured configuration (compared by restore group and resource key).
- **Bounded output**: the browser receives aggregate counts plus a bounded 120-change preview per section, with changed top-level field names and an omitted-record count for anything larger — so a huge catalog diff doesn't blow up the response.
- **Categorization**: every compared record lands in one of added / removed / changed / unchanged.

In short: **Snapshot Diff** = a server-computed, identity-matched, size-bounded comparison between two versions of the same snapshot series, covering catalog data, metafields, and configuration.

## What Notifications are

**Notifications** are the completion-and-status feed for catalog Operations — a transient toast layer plus a persistent inbox, both driven by polling the same tenant-scoped recent-operation endpoint.

### Key characteristics

- **Global observer**: the authenticated layout owns one completion-notification observer, so navigating away from a channel/snapshot page doesn't detach the browser from tracking its background Workflow.
- **Polling model**: the browser polls while the app tab is visible, and immediately rechecks when a catalog operation starts, another tab changes the active operation, or the tab regains visibility.
- **Terminal-state handling**: when the feed reports a locally tracked operation as completed/failed/cancelled, the observer removes it from browser state and refreshes the current route — clearing activity dots and disabled actions across Dashboard, Environment, Channel, and Snapshot surfaces. Operation-ID matching prevents a late-arriving result from clearing a *newer* task.
- **Linking**: completed captures link to their new immutable snapshot; restore/clear notifications link to the affected channel. A completed restore that needs manual follow-up (e.g. payment-visibility) shows an attention state with a direct Control Panel deep link, both in the popup and as a channel warning.
- **Two surfaces**:
  - **Toast**: a document-body-portaled popup anchored top-right, with an independent 30-second expiry per result; dismissal only affects the transient presentation.
  - **Inbox**: a bell-positioned panel (also a document-body portal, so it sits outside the sidebar's stacking context) that keeps entries counted in the bell badge until individually deleted or cleared via **Delete all**.
- **Per-user local state**: the inbox contents, the set of "seen" terminal operation IDs, and the last successful check are kept in local storage per Clerk user and synchronized across tabs, preventing duplicate notifications across route changes while retaining recent results until explicit cleanup.

In short: **Notifications** = the toast + inbox layer that surfaces catalog Operation completion/failure in real time, backed by tab-visibility-aware polling and per-user local state, without needing to keep the originating page open.

## What Database Sync is

**Database Sync** is the developer-only, explicitly-invoked mirror between the remote Turso database and a local SQLite file, used to pull production-like data down or push local changes up during development.

### Key characteristics

- **Explicit, not automatic**: only available from Settings → Development database, and only outside production (`next dev`); synchronization never happens automatically.
- **Whole-database replacement**: because snapshot, operation, schedule, staging, preference, favorite, environment, and audit rows share application-level IDs across tables, sync replaces the *entire* destination database image rather than merging table-by-table.
- **Schema reconciliation first**: before comparing or copying, the server applies the current idempotent schema and additive migrations independently to both local SQLite and Turso, then verifies every application table/column on both sides — refusing to continue if either side has queued or running catalog work.
- **Different write strategies per direction**:
  - **Local replacement** (pull) uses one write transaction.
  - **Turso replacement** (push) uploads the image into uniquely named staging tables via bounded atomic batches, then atomically swaps those staged rows into every visible application table in one short server-side batch — avoiding Turso's remote interactive-transaction expiry (which otherwise surfaces as an HTTP 404 on large pushes) while never leaving a partially replaced database if the upload fails.
- **Destructive confirmation**: push is intentionally presented as a destructive action because it replaces data for *every* tenant in Turso; encrypted access tokens remain encrypted at rest throughout the copy.
- **Legacy row handling**: notes created before authentication existed can have a null owner in an upgraded Turso table — the mirror omits those inaccessible rows rather than guessing an owner, and reports the skipped count in its result.
- **Audited but self-exempt**: pull/push are recorded as terminal **Database sync** rows in Operations after the mirror transaction completes (so the audit write can't block its own active-work guard, and a pull can't erase its own result), written first to local SQLite for immediate visibility with a best-effort mirror write to Turso. Unlike other catalog actions, Database Sync has no Workflow run — it's a developer-invoked bounded transaction, not a background job.
- **Privileged backup/restore is separate**: full Turso backup/restore (all tenants' data, including encrypted credentials) requires the signed-in email to appear in `DATABASE_BACKUP_ALLOWED_EMAILS` outside development, checked in the Route Handler before either operation reaches the active database.

In short: **Database Sync** = an explicit, developer-invoked, whole-database mirror between Turso and local SQLite (pull or push), using staged atomic swaps to avoid partial replacement, and always leaving an audit trail even though it isn't itself a Workflow.
