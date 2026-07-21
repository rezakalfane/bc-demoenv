# Implementation Details

This document describes the security model, required BigCommerce permissions, snapshot semantics, configuration portability, durable processing, and catalog restoration behavior of BigCommerce Demo Env.

## Database schema

The application uses Turso/libSQL. Clerk owns user identities externally, so `user_id` columns contain Clerk user IDs and do not reference a local users table. Relationships shown with dashed lines are application-enforced logical references; the schema intentionally defines no SQL foreign-key constraints so immutable snapshot and audit records can survive deletion of their source environment or snapshot.

```mermaid
erDiagram
    NOTES {
        INTEGER id PK
        TEXT user_id
        TEXT title
        TEXT created_at
    }

    BIGCOMMERCE_ENVIRONMENTS {
        INTEGER id PK
        TEXT user_id
        TEXT name UK
        TEXT store_hash
        TEXT access_token_encrypted
        TEXT access_token_hint
        TEXT created_at
        TEXT updated_at
    }

    CATALOG_SNAPSHOTS {
        INTEGER id PK
        TEXT user_id
        TEXT name UK
        INTEGER snapshot_version UK
        INTEGER format_version
        INTEGER source_environment_id
        TEXT source_environment_name
        TEXT source_store_hash
        INTEGER source_channel_id
        TEXT source_channel_name
        INTEGER category_count
        INTEGER product_count
        INTEGER variant_count
        INTEGER image_count
        INTEGER metafield_count
        INTEGER payload_bytes
        INTEGER has_translations
        TEXT payload_json
        TEXT published_at
        TEXT created_at
        TEXT updated_at
    }

    CATALOG_SNAPSHOT_EVENTS {
        INTEGER id PK
        TEXT user_id
        TEXT event_type
        TEXT snapshot_name
        INTEGER snapshot_id
        INTEGER snapshot_version
        TEXT payload_json
        TEXT created_at
    }

    CATALOG_SNAPSHOT_TAGS {
        TEXT user_id PK
        TEXT snapshot_name PK
        TEXT tag PK
        TEXT created_at
    }

    APPLICATION_EVENTS {
        INTEGER id PK
        TEXT user_id
        TEXT event_type
        TEXT resource_type
        INTEGER resource_id
        TEXT resource_name
        TEXT payload_json
        TEXT created_at
    }

    FAVORITES {
        TEXT user_id PK
        TEXT resource_type PK
        TEXT resource_key PK
        TEXT created_at
    }

    COLLECTION_VIEW_PREFERENCES {
        TEXT user_id PK
        TEXT collection_id PK
        TEXT view_mode
        INTEGER show_shared
        INTEGER sidebar_collapsed
        TEXT updated_at
    }

    USER_PROFILES {
        TEXT user_id PK
        TEXT first_name
        TEXT last_name
        TEXT timezone
        INTEGER local_scheduler_enabled
        TEXT updated_at
    }

    CATALOG_OPERATIONS {
        INTEGER id PK
        TEXT user_id
        TEXT kind
        INTEGER environment_id
        INTEGER channel_id
        INTEGER snapshot_id
        TEXT operation_key
        TEXT status
        TEXT current_step
        INTEGER step_index
        INTEGER total_steps
        TEXT payload_json
        TEXT result_json
        TEXT error
        TEXT workflow_run_id
        TEXT created_at
        TEXT updated_at
    }

    CATALOG_SCHEDULES {
        INTEGER id PK
        TEXT user_id
        TEXT name
        INTEGER environment_id
        INTEGER channel_id
        TEXT action
        TEXT frequency
        TEXT local_time
        INTEGER weekday
        TEXT timezone
        INTEGER enabled
        INTEGER snapshot_id
        TEXT snapshot_name
        TEXT restore_groups_json
        TEXT next_run_at
        TEXT last_run_at
        INTEGER last_operation_id
        TEXT last_error
        TEXT created_at
        TEXT updated_at
    }

    CATALOG_SNAPSHOT_CAPTURE_STATE {
        INTEGER operation_id PK
        TEXT user_id
        TEXT snapshot_name
        INTEGER environment_id
        INTEGER channel_id
        TEXT channel_json
        TEXT category_data_json
        TEXT category_records_json
        TEXT supporting_data_json
        TEXT product_ids_json
        INTEGER next_category_index
        INTEGER total_categories
        INTEGER initialization_complete
        INTEGER next_product_index
        INTEGER total_products
        TEXT created_at
        TEXT updated_at
    }

    CATALOG_SNAPSHOT_CAPTURE_PRODUCTS {
        INTEGER operation_id PK
        INTEGER product_index PK
        TEXT payload_json
        TEXT created_at
    }

    BIGCOMMERCE_ENVIRONMENTS o|..o{ CATALOG_SNAPSHOTS : "source for"
    BIGCOMMERCE_ENVIRONMENTS o|..o{ CATALOG_OPERATIONS : "targeted by"
    BIGCOMMERCE_ENVIRONMENTS o|..o{ CATALOG_SCHEDULES : "targeted by"
    BIGCOMMERCE_ENVIRONMENTS o|..o{ FAVORITES : "may be favored as"
    CATALOG_SNAPSHOTS o|..o{ CATALOG_SNAPSHOT_EVENTS : "described by"
    CATALOG_SNAPSHOTS o|..o{ CATALOG_SNAPSHOT_TAGS : "series labeled by"
    CATALOG_SNAPSHOTS o|..o{ CATALOG_OPERATIONS : "used by"
    CATALOG_SNAPSHOTS o|..o{ CATALOG_SCHEDULES : "selected by"
    CATALOG_SNAPSHOTS o|..o{ FAVORITES : "series may be favored as"
    CATALOG_OPERATIONS ||..o| CATALOG_SNAPSHOT_CAPTURE_STATE : "checkpoints"
    CATALOG_OPERATIONS ||..o{ CATALOG_SNAPSHOT_CAPTURE_PRODUCTS : "stages products"
    CATALOG_SCHEDULES o|..o| CATALOG_OPERATIONS : "last dispatched"
```

Important uniqueness rules and indexes are:

- Environment names are case-insensitively unique per user.
- Snapshot `(user_id, name, snapshot_version)` tuples are unique, and only one version per case-insensitive user/name series can be published.
- Snapshot tags use the composite primary key `(user_id, snapshot_name, tag)`. Both the series name and tag compare case-insensitively, so tags belong to the complete owner/name series rather than an individual immutable version. A series can have at most 12 tags of 1–32 characters; rename and deletion transactions move or remove the associated rows.
- Only one queued or running operation can exist for a non-null `(user_id, kind, operation_key)` tuple.
- Capture-product rows use the composite primary key `(operation_id, product_index)`.
- Favorites use the composite primary key `(user_id, resource_type, resource_key)`. Environment keys use the tenant-owned database ID, channel keys combine environment and BigCommerce channel IDs, and snapshot keys combine the owner Clerk ID with the normalized series name so a favorite survives new immutable versions. Snapshot rename and deletion reconcile those keys for every viewer.
- Collection view preferences use `(user_id, collection_id)` as their composite primary key. Collection IDs represent page types—Dashboard environments, Settings environments, environment channel lists, the Snapshots index, live channel products, captured snapshot products, Operations, and Notes—rather than individual environment, channel, or snapshot IDs. Those records store card/table mode and shared-snapshot visibility. A reserved `app-shell` collection ID stores the user's single desktop-sidebar collapse state for the whole authenticated application.
- User profiles use the Clerk `user_id` as their primary key and store display names, timezone, and the development-only local scheduler preference; account email remains authoritative and read-only in Clerk.
- Schedule names are descriptive labels and are intentionally not unique. Due schedules are indexed by `(enabled, next_run_at)`, while the catalog-operation active-key constraint prevents overlapping work for the same user/action/resource even when multiple schedules share a name or become due together.

## Scheduled automation

`catalog_schedules` stores one channel target per tenant-owned schedule, a daily or weekly local-time cadence, its IANA timezone, optional immutable snapshot version, selected restore groups, and next/last dispatch metadata. The editor uses the same favorite-aware environment/channel and snapshot/version patterns as manual restore. Snapshot schedules append a new immutable version to their named series; restore and **Clear & Restore** retain the chosen version and configuration groups so later publication changes do not silently change the scheduled source.

Vercel Cron calls `/api/scheduler/tick` once per day by default and authenticates with the server-only `CRON_SECRET`. This committed cadence is compatible with Vercel Hobby's daily limit; Pro and Enterprise deployments can use `* * * * *` for minute-level cloud dispatch. Local development can run a browser dispatcher for only the signed-in user, with a per-user interval of every minute or once per day. Its enablement and interval are independent from saved schedule state and from Vercel's production dispatcher. Concurrent dispatchers are safe: each attempts an atomic compare-and-update claim of the due timestamp before starting work, so only one advances that schedule occurrence. The catalog-operation partial unique index then rejects any second queued/running operation for the same action key and destination resource.

Manual **Run now** uses the same dispatch path without changing the saved cadence. Pause/resume updates return immediately and recalculate the next occurrence when resumed; editing or deleting a schedule never removes its retained Operations or Workflow history. The Scheduler page shows the user's current timezone clock and warns development users when their local dispatcher is disabled.

Clear, restore, snapshot, and composite refresh actions all become durable Workflow-backed catalog operations. **Clear & Restore** runs channel product unassignment and category cleanup first, then applies the selected snapshot only after clear succeeds. It uses one operation, progress surface, notification, and trace, so navigation, browser closure, Function timeout, and ordinary deployment restarts do not split or restart the sequence. Failures remain visible with their checkpoint and can be diagnosed from Operations and Workflows.

## Security and tenancy

### Development database mirror

Development can run against a dedicated SQLite file by setting `LOCAL_DATABASE_URL=file:local.db` while retaining `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as the remote mirror. Production ignores the local override. The sectioned Settings page combines account preferences, environments, and development-only services. Authenticated developers can use Settings → Development database to explicitly pull Turso into local SQLite or push local SQLite to Turso; synchronization is never automatic and is unavailable outside `next dev`. The Scheduler section persists a per-user development enablement switch and minute/daily interval without changing saved schedules or the production Vercel Cron dispatcher.

The mirror is a whole-database replacement because snapshot, operation, schedule, staging, preference, favorite, environment, and audit rows share application-level IDs across tables. Before comparing or copying, the server applies the current idempotent schema and additive migrations independently to local SQLite and Turso. It then verifies every application table and column on both sides and refuses to continue if either database has queued or running catalog work. This lets an older `user_profiles` table receive newly added preference columns before synchronization instead of failing with a schema-difference message. The server reads one consistent source image and rechecks active work. Local replacement uses one write transaction. Turso replacement first uploads the image into uniquely named staging tables through bounded atomic batches, then atomically swaps those staged rows into every visible application table in one short server-side batch. This avoids the remote interactive-transaction expiry that otherwise surfaces as an HTTP 404 during a large push, while keeping a failed upload from exposing a partially replaced database. Push is intentionally presented as a destructive confirmation because it replaces data for every Turso tenant; access tokens remain encrypted at rest throughout the copy. Legacy notes created before authentication can have a null owner in an upgraded Turso table; the mirror omits those inaccessible rows instead of guessing an owner or weakening the destination's tenant constraint, and reports the skipped count in its result.

Pull and push are recorded as terminal **Database sync** rows in Operations after the mirror transaction, so the audit row cannot block its own active-work guard and a pull cannot erase its own result. The application writes the audit to local SQLite for immediate visibility and makes the same best-effort write to Turso. Completed rows include source, destination, copied table and row counts, start/end timestamps, and duration; failed attempts retain the error without storing credentials. Database sync has no Workflow run because the developer explicitly invokes the bounded transaction from Settings.

Whole-database backup and restore are separate from the development mirror and operate on the database currently used by the application: local SQLite in development or Turso in local, Preview, and Production deployments. Export and restore share the in-instance maintenance lock and reject queued or running catalog operations. Restore validates the backup marker and version, requires the exact current application-table and column set, decodes binary and bigint values explicitly, omits inaccessible legacy notes without an owner, and replaces all tables in one transaction so a failed import rolls back completely.

Development permits authenticated users to use these controls. Outside development, the signed-in email must appear in the comma-separated `DATABASE_BACKUP_ALLOWED_EMAILS` server environment variable. The authorization check happens in the Route Handler before either export or restore reaches the active database. Backups include all tenants' data and encrypted BigCommerce credentials; encryption prevents casual token disclosure but does not make the backup non-sensitive, so downloaded files must be stored and transferred securely. Turso backup and restore therefore remain an explicitly privileged operational capability rather than ordinary tenant-scoped Settings behavior.

BigCommerce access tokens are encrypted with AES-256-GCM before storage. The application returns only the final four characters to the Settings UI and binds each encrypted value to its owning Clerk user. Reads, updates, deletes, and Dashboard credential lookups also include the Clerk user ID, so one user cannot access another user's settings. Dashboard API requests run only on the server and are never cached.

Settings credential diagnostics use the same tenant-scoped, server-only credential lookup and never return the decrypted token to the browser. **Test access** sends bounded, read-only requests to representative Catalog, Channels, Sites, storefront settings, Customers, Content, Shipping, Tax, Inventory, Pricing, Themes, and B2B Edition endpoints. BigCommerce store tokens do not expose a trustworthy scope-list response, so the report infers missing read scopes from `403` responses, distinguishes invalid credentials and rate limiting, and lists `404`/unsupported resources separately as unavailable for the tested store or channel type. APIs that are inapplicable—such as Stencil theme access on a Catalyst channel—do not make an otherwise valid credential appear broken. Modify permissions are never exercised: restore and clear capabilities explicitly remain **Write not tested** and name the modify scopes required.

Snapshot payloads contain catalog data and public image links, but never BigCommerce access tokens.

Favorites are private presentation metadata. Every favorite lookup and toggle includes the current Clerk user ID; the Server Action also verifies ownership of environments and channels or current access to an owned/published snapshot before accepting the mutation. Favorite status never grants access to a resource that is no longer otherwise visible.

Collection browsing keeps resource rendering on the server. A narrow Client Component toolbar controls sibling Server-rendered cards and compact table rows through stable data attributes. Dashboard environments, saved Settings environments, channel lists, snapshot series, and live/captured product browsers expose the same left-aligned instant search and right-aligned 32-pixel card/table controls. Filtering operates only on the already-authorized display model received from the Server Component; credentials, snapshot payloads, and raw BigCommerce responses never cross this boundary. Compact administrative tables preserve primary navigation and resource actions with horizontal overflow on narrow screens; catalog product tables instead use a fixed percentage layout with wrapping and line clamping so all four columns remain visible beside the category tree on desktop. Snapshot collections add a separate eye control that hides or reveals shared read-only series without affecting owned snapshots or in-progress captures, plus a multi-select tag filter. A snapshot must contain every selected tag, enabling increasingly narrow intersections without another server request. Card/table selection and shared-snapshot visibility are persisted by page type through authenticated Server Actions in `collection_view_preferences`; switching one live channel catalog changes the preference for every live channel catalog, while snapshot catalogs and other page types remain independent. Each desktop page also exposes a small arrow on the sidebar edge. Collapsing it converts navigation to an icon rail, removes the shell and page-content maximum widths, and stores one global `app-shell` preference for that user, so the navigation remains consistent while moving between pages. Existing page-scoped collapsed choices are folded into the global value until the user explicitly toggles it. Each write and initial read derives the Clerk user ID server-side, and the saved initial state is rendered on the server to avoid a layout flash. The persistent app layout carries that authorized preference map through client navigation, allowing Dashboard, environment, Snapshots, and product loading boundaries to render card or compact-table skeletons that match the selected mode. Search text and selected tag filters remain intentionally transient.

## BigCommerce access scopes

For catalog-only Dashboard metrics and snapshot capture, **Products: read-only** and **Channel Settings: read-only** are sufficient. Capturing every optional configuration section also benefits from Sites & Routes, Information & Settings, Themes, Content, the corresponding Shipping/Tax read scopes, and **B2B Edition: read-only**.

Catalog restore needs **Products: modify**; selected configuration sections require their matching modify scopes. Localization translation restore specifically needs **Content: modify** (the `store_content` OAuth scope), and B2B restore needs **B2B Edition: modify**.

Deleted channels are excluded from totals, navigation, and restore destinations. Snapshot creation fails when required catalog data is incomplete, while optional configuration authorization failures are recorded as manifest warnings.

## Snapshot storage, capture, and publication

Snapshot names define case-insensitive, per-user version series; each row is uniquely identified by name and snapshot version, metadata is indexed separately for fast navigation, and no retained payload is overwritten. Custom tags are series-level presentation metadata: owners can add or remove several tags optimistically while earlier writes finish in the background, receive autocomplete suggestions from existing database tags, and see only the affected tag roll back if a write fails. The reserved `localized` label is never stored as a custom tag: capture finalization computes a per-version `has_translations` flag from non-empty product or category translation records and stores it beside the manifest. Existing versions receive a one-time schema backfill. Snapshot list queries read this compact metadata instead of recursively scanning every manifest JSON payload, while snapshot details and filters still expose it as a read-only computed tag. Published viewers can use the shared tags and the published version's localization status for filtering but cannot edit them. Publication is opt-in and limited to one version per owner/series; unpublishing immediately removes cross-tenant access.

Snapshot owners can compare any two retained versions in the same series without sending their multi-megabyte manifests to the browser. The authenticated Server Action reloads both versions through the existing tenant/publication access predicate, confirms that their owner and case-insensitive series name match, and computes a directional source-to-destination diff on the server. Stable category paths, product SKUs or slugs, variant SKUs or option values, image URLs, and namespace/key metafield identities distinguish added, removed, changed, and unchanged resources. Product child collections are compared separately, and the metafield section includes category, product, and variant metafields. Captured configuration is compared by restore group and resource key. The browser receives only aggregate counts plus a bounded 120-change preview per section, with changed top-level field names and an omitted-record count for larger catalogs.

Product capture resolves BigCommerce channel assignments first, then loads only the assigned product IDs. Reads are serialized per store and use BigCommerce quota/reset headers for proactive throttling and automatic 429 retries.

Configuration capture is best-effort by resource. Missing OAuth scopes, APIs unavailable for a channel type, and unsupported provider configuration are retained as warnings instead of invalidating the catalog snapshot.

## Configuration restoration

Restore starts with Catalog selected and the safe configuration groups opt-in: Storefront settings, Checkout & customer experience, Pricing & currencies, Shipping, Tax, Inventory & locations, B2B Edition, and Localization & presentation.

### Storefront settings

The Storefront settings group resolves inherited global values into effective source values and creates explicit destination-channel overrides for contact display name, address and phone, text/image logo and favicon, SEO and robots.txt, product/category display, catalog preferences, inventory rules, search, status messages, and customer privacy.

The captured contact email remains inspectable but is never restored, preserving the destination store's notification identity. Customer-group selections are remapped by name; empty customer-group responses are treated as no configured groups. Empty textual logos are skipped because BigCommerce rejects them, while image logos and favicons use their dedicated upload endpoints instead of the text-logo settings endpoint. Generated prelaunch passwords and global-only search flags are never submitted.

Captured channel properties, metafields, sites, and routes remain inspect-only and cannot be restored, protecting destination Makeswift integration, URLs, routing, domains, and checkout configuration.

### B2B Edition

Shipping, Tax, Inventory, and B2B Edition are marked store-wide. The B2B group captures permissions, roles, Companies, users, addresses, hierarchy links, shopping lists, quotes, orders, invoices, payments, Company attachment metadata, sales representatives, and extra-field definitions.

Restore additively reconciles custom permissions and roles, Companies, users, addresses, hierarchy links, and shopping lists. Quotes are not recreated because the B2B API automatically submits them to buyers; B2B orders cannot create their underlying BigCommerce orders; invoices, payments, attachment binaries, sales-representative identities, and extra-field definitions remain captured audit data with restore warnings. Creating Companies or users can trigger BigCommerce account or welcome email.

Publishing a snapshot also shares its captured B2B demo data with other authenticated application users, so published versions must contain demo-safe identities and business records only.

Stable resources are reconciled by names and generated IDs; destination domains, SSL ownership, carrier/payment/tax-provider credentials, fulfillment mappings, and other secrets are never copied. Mapping-sensitive resources that cannot be applied safely remain recorded in the immutable manifest and are surfaced as restore warnings.

### Localization and translations

Localization capture records the source channel's locales and its effective default country, falling back to the store default when the channel inherits it. Localization restore writes that country specifically to the destination channel, adds captured locales that are missing without removing unrelated destination locales, respects BigCommerce's five-locale channel limit, and activates the captured default locale after reconciliation.

Product and category translations are mapped independently from Catalog restoration using stable product SKUs/slugs and category paths, so Localization can be restored on its own after the destination catalog already exists.

The live channel browser loads configured channel locales and paginated product/category translations server-side. Snapshot browsing reads the equivalent locale and translation resources from the immutable manifest. A locale selector appears beside the currency only when more than one locale is available; it preserves the locale through category navigation, falls back to the original catalog text when a translated field is absent, and uses the selected locale for price formatting.

Snapshots whose visible version has at least one captured product or category translation edge receive the computed `localized` tag. The canonical manifest check runs once during direct or durable capture finalization and persists the result in `catalog_snapshots.has_translations`; legacy rows are backfilled once during schema migration. Because translation contents are immutable per version, a series can gain or lose this label when the latest owned version changes or when its published version changes. Snapshot-series reads use only the persisted flag and retry transient Turso gateway failures; a failed schema-initialization promise is also reset so a later request can recover.

### Shipping

Shipping restore reuses BigCommerce's immutable global zone, reconciles other zones by name, and creates or updates the captured methods with their rates and enabled state. Newly created methods are assigned to the channel being restored; existing methods retain their current channel assignments and add only that destination channel. Read-only response fields are removed from write payloads, and detailed BigCommerce validation messages are retained in operation warnings.

### Tax

Tax restore maps BigCommerce's immutable default zone to destination zone `1` and restores its editable display settings without sending `shopper_target_settings` or `enabled`. Default-zone status, locations, and customer groups are owned by BigCommerce and cannot be changed; ordinary tax zones retain their captured targeting. Existing destination zone IDs continue to be mapped even if a best-effort metadata update produces a warning, so captured tax rates can still reconcile.

### Currencies and payment visibility

Currency restore creates or enables missing currencies globally in the destination store from the snapshot's captured definitions, including transactional currencies. Because BigCommerce can expose a newly created store currency to channels that inherit global defaults, restore first records every unrelated live channel's currency visibility and reapplies those assignments after the global mutation. The snapshot's enabled and default currencies are then assigned only to the channel being restored. Older snapshots can reconstruct their default currency from catalog currency metadata; secondary currencies still require a captured store definition or prior destination setup.

BigCommerce currently restricts payment-profile channel associations to its authenticated Control Panel service rather than the public store-token APIs used by background restore jobs. A pricing restore therefore records a manual action in channel and snapshot History for the restored currencies, with a direct link to **Payments → Manage Channel Visibility**. Use that action to assign the intended gateway configuration—such as Test Payment Provider—to the destination channel without copying or persisting Control Panel session credentials.

## Durable catalog processing

Large snapshot captures persist their source channel and category-tree seed first, then checkpoint retryable 10-category and 30-product Workflow batches in Turso before an atomic finalization transaction creates the immutable snapshot version. Category attributes and metafields therefore resume from the last saved category batch instead of restarting the entire initialization phase after a worker restart. Closing the browser, navigating away, an individual Function timeout, or a deployment does not discard completed batches. In local development, Workflow runtime metadata is stored below `.next/workflow-data`; a development-server restart or a local build can therefore leave Turso with a valid checkpoint whose old local run is orphaned or no longer present. An active operation whose last heartbeat predates the current `next dev` process—or the latest matching operation that reports that exact missing-run failure—is atomically claimed for recovery. The orphaned run is cancelled when it still exists, then a replacement Workflow run continues the same operation from its Turso cursor. Recovery clears the old run ID during the compare-and-swap claim, refuses any operation superseded by a newer row with the same operation key, and treats concurrent unique-index races as an unclaimed recovery. This prevents multiple polling pages or historical failures from starting duplicate runs or breaking the shared operation feed. In deployed environments, a capture with no server heartbeat for ten minutes is marked failed instead of remaining permanently active, and its name becomes available for another attempt.

Restore and clear operations also start registered Vercel Workflow runs instead of relying on a browser request or a Next.js `after()` callback. Their Workflow run IDs are stored with the tenant-owned operation row in Turso, allowing the API to reconcile run state after navigation, reload, deployment, or a Function restart. Restore checkpoints the selected catalog/configuration groups as retryable steps; clear safely re-reads the remaining channel assignments and categories when a step is retried. Cancellation stops the Workflow run and updates the same operation row used by the channel, environment, dashboard, snapshot, and History views.

The authenticated layout owns a global completion-notification observer, so leaving a channel or snapshot page does not detach the browser from its background work. A tenant-scoped recent-operation endpoint reconciles active Workflow runs and exposes terminal status, affected IDs, result labels, errors, and only the count of recorded manual actions. The browser polls while the application is visible and immediately rechecks when a catalog operation starts, another tab changes the active operation, or the tab regains visibility. When the feed reports the locally tracked operation as completed, failed, or cancelled, the observer removes that exact operation from browser state and refreshes the current route; activity dots and disabled actions therefore clear across Dashboard, environment, channel, and snapshot surfaces without first opening the detail progress panel. Operation-ID matching prevents a late result from clearing a newer task. Completed captures link to their new immutable snapshot; restore and clear notifications link to the affected channel. Failed operations remain actionable through the same resource link, while a completed restore with manual work uses an attention state and directs the user to channel History for the full validated action and external Control Panel link. Each new result creates a document-body popup anchored to the page viewport's top-right, with an independent absolute 30-second expiry, plus a persistent entry in the sidebar notification center. Both the transient toast layer and bell-positioned inbox panel use document-body portals, keeping them outside the backdrop-filtered sticky sidebar's stacking context and above page content. The panel recalculates its fixed viewport position when opened, resized, or scrolled. Popup dismissal affects only the transient presentation; inbox entries remain counted in the bell badge until individually deleted or cleared with **Delete all**. The inbox, seen terminal operation IDs, and last successful check are kept per Clerk user in local storage and synchronized across tabs, preventing duplicate notifications across route changes while retaining recent results until explicit cleanup.

The root layout registers a same-origin service worker whose only cached resource is a generic, identity-free offline shell. Navigation remains network-first and authenticated pages, RSC responses, API payloads, credentials, and catalog data are never cached. After the worker has activated during one successful load, a failed document navigation falls back to the shell while retaining the requested URL in the address bar. The shell sends uncached `HEAD` probes directly to that URL every 2.5 seconds; because the worker intercepts document navigations only, these probes reflect real server availability. A successful response below the 500 range reloads the preserved route. Catalog-operation progress polling separately treats connection failures as transient, retaining the last visible state and retrying instead of producing an unhandled Next.js development overlay.

The Operations page merges the complete `catalog_operations` Workflow ledger, `catalog_snapshot_events`, and the lightweight `application_events` audit stream with mandatory Clerk user predicates. It covers snapshot capture, restore, clear, rename, publish, unpublish, version deletion, whole-series deletion, and environment creation/deletion. Existing live environments created before the audit migration are represented from their tenant-owned creation timestamps; historical deleted resources cannot be reconstructed. New environment and whole-snapshot mutations write their audit event atomically with the resource mutation, retaining safe names, identifiers, counts, and timestamps after deletion without storing access tokens or snapshot payloads. A narrow Client Component receives the serializable display model for local sorting, filtering, and detail-modal interactions; encrypted credentials and raw access tokens never cross the Server Component boundary. Visibility-aware route refreshes discover operations started elsewhere and run more frequently while work is active, without discarding the user's table filters. The table uses a fixed layout, bounded progress/result text, and two-line date/time cells so long current-step labels or timestamps cannot resize neighboring columns. Manual-action URLs are validated as HTTPS BigCommerce Control Panel links before they are exposed. The detail view includes persisted progress, result counters, restore groups, warnings, errors, Workflow IDs, resource IDs, and direct tenant-safe application links. Operations uses the same arrow-controlled, globally persisted sidebar layout as every other authenticated page.

The Workflows subpage is an authenticated observability projection over tenant-owned `catalog_operations` rows and available Vercel Workflow runtime metadata. It never enumerates another user's runs. The table can search, filter, sort, refresh, cancel an active run, retry a failed or cancelled operation as a new run, copy its run ID, and return to the affected channel or snapshot. Operations link directly to their exact workflow detail using the operation ID. Runtime names are normalized for display while the original compiler-generated name remains available under Technical details. Application status remains authoritative when archived local runtime metadata is no longer available.

The visual trace combines native durable steps with application-level macro stages inferred from persisted checkpoint cursors, step indexes, and exact progress messages. Snapshot configuration capture expands into Channel & storefront settings, Checkout & customer experience, Pricing & currencies, Shipping, Tax, B2B Edition, and Inventory/localization/presentation. Clear expands into Initialize, Unassign products, Remove channel categories, and Verify catalog is clear. A terminal failure or cancellation is therefore attached to the active macro stage rather than incorrectly marking a later product or finalization phase. These macro stages improve application diagnostics without claiming to be separate Vercel `"use step"` spans; the original runtime workflow name and native run remain inspectable separately.

### Snapshot capture Workflow

```mermaid
flowchart TD
    start([Start snapshot capture]) --> initialize["initializeSnapshotStep<br/>Validate operation and persist channel/category seed<br/>maxRetries: 2"]
    initialize --> categories{"Categories remaining?"}
    categories -- Yes --> categoryBatch["captureCategoryBatchStep<br/>Capture next 10 categories and checkpoint<br/>maxRetries: 4"]
    categoryBatch --> categories
    categories -- No --> completeInit["completeSnapshotInitializationStep<br/>Capture supporting configuration and product IDs<br/>maxRetries: 2"]
    completeInit -. Application trace .-> settings["Configuration macro stages<br/>Storefront → Experience → Pricing → Shipping<br/>→ Tax → B2B → Localization & inventory"]
    completeInit --> remaining{"Products remaining?"}
    remaining -- Yes --> productBatch["captureProductBatchStep<br/>Capture next 30 products and checkpoint<br/>maxRetries: 4"]
    productBatch --> remaining
    remaining -- No --> finalize["finalizeSnapshotStep<br/>Create immutable version atomically<br/>maxRetries: 2"]
    finalize --> success([Snapshot captured])

    initialize -. Error .-> fail["failSnapshotStep<br/>Persist failure and release active name<br/>maxRetries: 2"]
    categoryBatch -. Error after retries .-> fail
    completeInit -. Error .-> fail
    productBatch -. Error after retries .-> fail
    finalize -. Error .-> fail
    fail --> failed([Failed])

    classDef terminal fill:#064e3b,color:#ecfdf5,stroke:#10b981,stroke-width:2px;
    classDef failure fill:#450a0a,color:#fef2f2,stroke:#ef4444,stroke-width:2px;
    class start,success terminal;
    class fail,failed failure;
```

### Snapshot restore Workflow

```mermaid
flowchart TD
    start([Start snapshot restore]) --> initialize["initializeCatalogOperationStep<br/>Validate payload and selected groups<br/>maxRetries: 2"]
    initialize --> more{"Next selected restore group?"}
    more -- Yes --> group["restoreCatalogGroupStep<br/>Restore one catalog/configuration group<br/>maxRetries: 3"]
    group --> more
    more -- No --> complete["completeRestoreOperationStep<br/>Combine results, warnings, and manual actions<br/>maxRetries: 2"]
    complete --> success([Restore completed])

    initialize -. Error .-> fail["failCatalogOperationStep<br/>Persist terminal failure unless cancelled<br/>maxRetries: 2"]
    group -. Error after retries .-> fail
    complete -. Error .-> fail
    fail --> failed([Failed])

    classDef terminal fill:#064e3b,color:#ecfdf5,stroke:#10b981,stroke-width:2px;
    classDef failure fill:#450a0a,color:#fef2f2,stroke:#ef4444,stroke-width:2px;
    class start,success terminal;
    class fail,failed failure;
```

### Clear catalog Workflow

```mermaid
flowchart TD
    start([Start catalog clear]) --> initialize["initializeCatalogOperationStep<br/>Validate payload and mark running<br/>maxRetries: 2"]
    initialize --> clear["clearCatalogStep<br/>Unassign channel products, remove categories,<br/>then verify BigCommerce state<br/>maxRetries: 3"]
    clear -. Application trace .-> clearMacros["Clear macro stages<br/>Unassign products → Remove channel categories<br/>→ Verify catalog is clear"]
    clear --> complete["completeClearOperationStep<br/>Persist counts and completed status<br/>maxRetries: 2"]
    complete --> success([Catalog cleared])

    initialize -. Error .-> fail["failCatalogOperationStep<br/>Persist terminal failure unless cancelled<br/>maxRetries: 2"]
    clear -. Error after retries .-> fail
    complete -. Error .-> fail
    fail --> failed([Failed])

    classDef terminal fill:#064e3b,color:#ecfdf5,stroke:#10b981,stroke-width:2px;
    classDef failure fill:#450a0a,color:#fef2f2,stroke:#ef4444,stroke-width:2px;
    class start,success terminal;
    class fail,failed failure;
```

The restore and clear paths are two branches of `catalogOperationWorkflow` and therefore share their initialization and failure steps. Cancellation is initiated through the catalog-operation API by cancelling the registered run and persisting `cancelled`; it is run control rather than a `"use step"` function, so it is not shown as a step node above.

Restore is presented as a three-step wizard: choose the snapshot and version plus the destination, select the available restore sections, then review the destination preflight and enter the typed confirmation. On channel pages, Snapshot and Version are separate selectors: selecting a snapshot chooses its newest version, the Version selector contains only that series, and a star identifies its published version. The step header exposes progress and permits returning to completed steps, while the modal footer keeps Cancel, Back, Continue, preflight, and final Restore actions visible independently from scroll position. Changing a prior selection invalidates confirmation and requires a fresh preflight.

The read-only preflight is bound to the exact snapshot version, destination environment/channel, and selected restore groups. It revalidates snapshot access and destination ownership, resolves existing category paths and product SKU/slug matches, and presents the result as a compact Snapshot → Destination comparison. Categories and products are separated into snapshot totals, new records, matched records, destination-only records that will be skipped and preserved, and conflicting source records. Channel assignments distinguish existing from new assignments; mixed/store-wide sections show their captured resource counts and scope; warnings, blockers, and required manual payment-visibility work remain explicit. The server reruns the same preflight immediately before creating the durable restore operation.

## Catalog restoration behavior

Restoration is cross-store and cross-channel. It maps category hierarchy by URL slug and products by any matching SKU or product slug. Existing matched products keep their attributes, variants, images, metadata, and stock; restore only associates them with the snapshot categories and destination channel.

Missing products are created in full, including mapped brands, tax classes, option/value IDs, variants, images, catalog metadata, aggregate product/variant inventory levels, category links, and channel assignment. Location-specific Inventory API balances and reservations are not captured. Restoration is additive: categories, products, variants, and channel assignments absent from the snapshot are preserved.

## Partial restoration and retries

BigCommerce does not provide a transaction spanning the complete catalog restore. If an API request fails, the destination can be partially updated; the error remains visible in the modal and rerunning the same immutable snapshot continues the deterministic reconciliation. Metafields owned privately by a different API client can still be rejected by BigCommerce.

Review the selected environment/channel carefully and take a fresh snapshot before restoring when you need a manual rollback point.
