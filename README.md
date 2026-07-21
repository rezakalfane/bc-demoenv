# BigCommerce Demo Environments Manager

A deployable Next.js 16 application with the App Router, Tailwind CSS 4, Turso/libSQL, and Clerk passwordless authentication. After signing in, users get a shared application sidebar with a live BigCommerce Dashboard plus private Snapshots, Notes, and Settings pages. Every database query is scoped to the authenticated Clerk user.

![BigCommerce Demo Environment Manager](./docs/images/bc-demoenv-00.png)

## Key features

- Passwordless authentication with email codes or login links, restricted to approved company domains.
- Multi-tenant isolation for environments, credentials, notes, preferences, schedules, and favorites.
- Encrypted BigCommerce access-token storage with credential and API-scope diagnostics.
- Live dashboards for environments, channels, categories, products, and variants.
- Searchable environment and channel browsing with favorites, card/table views, and collapsible navigation.
- Channel-specific catalog browsing with category trees, product grids, localization, and currency display.
- Versioned catalog snapshots containing categories, products, variants, images, metafields, inventory, translations, and supported configuration.
- Published read-only catalog templates that can be shared with other authenticated users.
- Snapshot tags, localization tags, favorites, version history, filtering, and version-to-version comparison.
- Durable background workflows for snapshot capture, catalog restore, catalog clearing, and Clear & Restore.
- Cross-store and cross-channel restoration with ID remapping, preflight comparisons, configurable sections, and detailed warnings.
- Optional restoration of storefront settings, pricing, currencies, shipping, tax, inventory, localization, and B2B Edition data.
- Timezone-aware daily or weekly schedules for snapshot, clear, restore, and Clear & Restore operations.
- A searchable and sortable Operations ledger with progress, results, warnings, and resource links.
- A Workflow debugger with execution stages, checkpoints, inputs, outputs, active steps, and technical details.
- Live progress indicators and notifications for completed work, failures, and required manual actions.
- Deep links to relevant BigCommerce Control Panel pages when manual configuration is required.
- Persistent user preferences for layouts, navigation state, shared snapshots, timezone, and profile information.
- English, French, Spanish, and Italian interface localization selected from the user profile and retained across devices.
- Local SQLite development with Turso synchronization, database backup, and restore tools.
- Automatic recovery of interrupted durable operations and a reconnecting server-unavailable screen.
- A responsive dark interface with compact tables, multi-column cards, skeleton states, and accessible controls.

## Application pages

- **Dashboard** summarizes saved BigCommerce environments and links to their channels and live catalog metrics.
- **Channel catalog** browses channel-assigned categories and products, with actions to capture, restore, clear, and inspect History.
- **Snapshots** manages versioned catalog templates, tags, publishing, comparison, configuration inspection, and restoration.
- **Operations** searches and filters current and past work, while **Workflows** exposes execution stages, checkpoints, and diagnostics.
- **Scheduler** configures daily or weekly snapshot, clear, restore, and Clear & Restore automations.
- **Notes** provides a private scratchpad backed by Turso.
- **Settings** manages profiles, preferences, BigCommerce credentials, scope diagnostics, scheduler controls, database synchronization, backups, and restores.

## Implementation details

See [`DETAILS.md`](./DETAILS.md) for security and tenancy, required BigCommerce scopes, snapshot semantics, configuration portability, durable processing, and catalog restoration behavior.

Interface copy lives in the structured resource bundles under `src/i18n/`. Run `npm run i18n:check` when changing visible text; it verifies four-locale resource parity, stable keys, duplicate values, placeholders, and source coverage.

## Local development

Node.js 20.19 or newer is required. Clerk credentials are required; the database can use a local SQLite file for development.

When `LOCAL_DATABASE_URL` and Turso credentials are both configured, Settings → Development database provides explicit pull and push controls. Every attempt is retained in Operations with its direction, row/table totals, duration, and failure details.

```bash
npm install
npx vercel@latest link
npx vercel@latest integration add clerk
npx vercel@latest env pull .env.local --yes
```

Add a stable encryption secret to `.env.local` before saving BigCommerce environments:

```bash
openssl rand -base64 32
```

Store the generated value as `SETTINGS_ENCRYPTION_KEY`. For local compatibility the app can derive a key from `CLERK_SECRET_KEY`, but a dedicated value is recommended and must remain stable so saved tokens remain decryptable after Clerk key rotation.

Configure the Clerk development instance under **User & authentication**:

1. Require email addresses for sign-up and select **Email verification code**.
2. Enable email sign-in with both **Email verification code** and **Email verification link**.
3. For corporate inboxes that inspect links, disable **Require the same device and browser** so the scanner does not cause `client_mismatch`. This improves link reliability but weakens Clerk's protection against an attacker initiating a link flow for somebody else's email address. Prefer email codes when that tradeoff is unacceptable.
4. Do not require profile fields beyond email, and disable required passwords so code-based sign-up can complete without collecting a password. Social strategies can remain enabled in Clerk, but this custom page does not expose them.

Email codes remain the recommended default for corporate Microsoft Outlook and Office 365 inboxes. Their security scanners can follow a login link before the user clicks it. The original page must remain open while a login-link flow is pending so it can complete the session automatically.

Under **Restrictions**, enable the allowlist and add `*@bigcommerce.com` and `*@commerce.com`. The application also checks these exact domains in the browser and on the server, so protected pages remain unavailable to any other Clerk account.

Start the application and open [http://localhost:3000](http://localhost:3000):

```bash
npm run dev
```

After one successful online load, a lightweight service worker caches only a generic offline shell—not authenticated pages, API responses, or catalog data. If the development server stops or restarts, reloading any application URL shows the branded server-unavailable screen, preserves the exact requested path, checks availability every 2.5 seconds, and reloads that same page automatically when Next.js is reachable again. Transient background-operation polling failures remain silent and resume on their next interval.

Without Turso variables, local development creates `local.db` in the project directory. To keep Turso configured while running the app against a separate local database, set `LOCAL_DATABASE_URL=file:local.db`. Settings → Development database then provides explicit **Pull from Turso** and **Push to Turso** actions; neither direction runs automatically. Both actions apply the current additive application schema to local SQLite and Turso before comparing them, replace the complete destination database, refuse to run while catalog workflows are active, validate matching schemas, and commit the replacement transactionally.

Settings → Database backup & restore works independently of that development mirror. It downloads a versioned JSON backup of every application table from the active database and can transactionally restore the same format to local SQLite or Turso. Restore validates the exact table and column set, refuses to run while catalog workflows are active, and omits inaccessible legacy notes that have no owner. These files contain every tenant's data and encrypted access tokens and must be handled as secrets. Outside development, add a comma-separated allow-list of trusted operator emails as `DATABASE_BACKUP_ALLOWED_EMAILS`; users not on that list can see the section but cannot invoke either action.

To use Turso, add the Marketplace integration and pull the updated environment:

```bash
npx vercel@latest integration add tursocloud/database
npx vercel@latest env pull .env.local --yes
```

## Deploy to Vercel

Provision both Marketplace integrations before the first deployment:

```bash
npx vercel@latest link
npx vercel@latest integration add clerk
npx vercel@latest integration add tursocloud/database
npx vercel@latest env pull .env.local --yes
npx vercel@latest deploy
```

The `workflow` package and `withWorkflow()` integration automatically provision Vercel Workflow storage, queues, authenticated handlers, retries, and observability during deployment; no additional secret or Marketplace integration is required. Snapshot runs can be inspected from the Vercel project Workflow view or with `npx workflow inspect runs --backend vercel`.

Clerk injects `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Turso injects `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Apply the Clerk settings from the local-development section to both development and production instances.

For live cross-user snapshot publication updates, create an Ably app and add its server API key as `ABLY_API_KEY` in Development, Preview, and Production. Browsers receive short-lived Clerk-protected, subscribe-only tokens; the API key is never exposed client-side. When configured, Publish and Unpublish actions notify open Snapshots pages immediately and those pages refresh their authoritative data from Turso. Without Ably—or if a realtime event is missed—the page uses a visibility-aware 30-second fallback refresh.

Add `SETTINGS_ENCRYPTION_KEY` to the Development, Preview, and Production environments in Vercel before users save BigCommerce access tokens. Treat it as a permanent secret: changing it prevents existing tokens from being decrypted.

Add `DATABASE_BACKUP_ALLOWED_EMAILS` to the Vercel environments where whole-database maintenance should be available. Use a comma-separated list such as `operator@bigcommerce.com,backup-owner@commerce.com`. This privileged control exports and replaces the complete Turso application database, not only the current user's rows.

Add a server-only `CRON_SECRET` to the Vercel environments that run scheduled catalog automation. Vercel includes it as a bearer token when invoking the configured `/api/scheduler/tick` Cron route; requests without the matching token are rejected. The committed schedule runs once per day so it deploys on Hobby. Pro and Enterprise projects can change `vercel.json` to `* * * * *` when minute-level cloud dispatch is required.

The app creates or migrates the `notes` table and creates the `bigcommerce_environments`, `catalog_snapshots`, `catalog_snapshot_tags`, `catalog_snapshot_events`, `application_events`, `catalog_operations`, `catalog_schedules`, `user_profiles`, `favorites`, `collection_view_preferences`, and snapshot-capture staging tables on the first authenticated request. All application queries use tenant-aware indexes and user-scoped predicates. Snapshot rows persist their computed localization status beside the manifest; existing rows receive a one-time migration backfill. Snapshot tags are attached to the owner/name series rather than an immutable version and are reconciled when that series is renamed or deleted. Snapshot events preserve version lifecycle records, application events preserve safe environment and whole-snapshot deletion audit metadata, favorite keys preserve each user's preferred ordering without exposing resources across tenants, collection preferences retain card/table and shared-snapshot visibility per page type plus one global sidebar-width choice per user, profile rows store account presentation, timezone, and development scheduler preferences, schedule rows retain the next run and last dispatch result, and operation rows persist background status, Workflow run IDs, progress, results, warnings, and errors. Notes created before authentication was added can remain ownerless and hidden in an upgraded database. Development database mirroring omits those inaccessible legacy rows instead of guessing an owner or weakening tenant constraints.

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

- [`DETAILS.md`](./DETAILS.md) documents security, snapshot, configuration, and restoration behavior.
- [`CHANGELOG.md`](./CHANGELOG.md) records commits and merges in reverse chronological order.
- [`HISTORY.md`](./HISTORY.md) records user prompts and implementation summaries in reverse chronological order.
