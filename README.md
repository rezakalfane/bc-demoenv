# BigCommerce Demo Env

A deployable Next.js 16 application with the App Router, Tailwind CSS 4, Turso/libSQL, and Clerk passwordless authentication. After signing in, users get a shared application sidebar with a live BigCommerce Dashboard plus private Snapshots, Notes, and Settings pages. Every database query is scoped to the authenticated Clerk user.

## Application pages

- **Dashboard** shows live channel, category, product, and variant totals for every saved environment in a responsive three-column grid. Environment names link to a tenant-scoped detail page listing each non-deleted channel and its primary storefront URL.
- **Channel catalog** opens from an environment's channel list and shows an expandable category tree beside a responsive product grid with images, names, short descriptions, and calculated prices. Selecting a category filters the grid to products assigned to that category or any of its descendants. Channel actions include modal snapshot capture, selecting any saved snapshot/version for restoration, and clearing category contents plus channel assignments without deleting products. Snapshot capture runs as a durable Vercel Workflow with resumable product batches; restore and clear use persisted background operations. All three expose reload-safe progress, cancellation, rate-limit backoff, and channel-scoped History.
- **Snapshots** creates named, tenant-owned catalog templates from products assigned to a selected channel and browses captured categories and products with the same tree and grid experience. The template index merges versions into one card per snapshot-name series, orders published series first and remaining series second with each group sorted by name, and shows the latest capture plus its total version count. The naming form suggests existing series with their latest version and source channel. Reusing a name—or choosing **Create new version**—shows confirmation details, then saves an immutable next version while retaining earlier versions. **Choose version** browses captures, publishes or unpublishes one shared version per series, and can delete any unpublished version other than the one currently being viewed; publish, unpublish, and deletion events are retained in History with version, source, and catalog details, and deleted version numbers are never reused. Published snapshots use blue sharing indicators and appear to other authenticated users as read-only templates that expose only the published version and identify the publisher by email. Other users can inspect that immutable catalog and restore it to their own active channels, but cannot create versions, browse private versions or History, publish, unpublish, or delete it. **Restore Snapshot** can provision any active channel in any environment owned by the logged-in user after showing the source, destination, catalog counts, destructive effects, and a typed confirmation. Each manifest stores full category and product API records, variants, options, modifiers, custom fields, pricing rules, videos, image links, aggregate inventory fields, product/variant/category metafields, brands, tax classes, hierarchy, and product-category links.
- **Notes** provides a private scratchpad backed by Turso.
- **Settings** manages named BigCommerce environments with a store hash and API access token.

BigCommerce access tokens are encrypted with AES-256-GCM before storage. The application returns only the final four characters to the Settings UI and binds each encrypted value to its owning Clerk user. Reads, updates, deletes, and Dashboard credential lookups also include the Clerk user ID, so one user cannot access another user's settings. Dashboard API requests run only on the server and are never cached.

For Dashboard metrics, channel details, and snapshot capture only, **Products: read-only** and **Channel Settings: read-only** are sufficient. To restore snapshots, the destination store-level API account needs **Products: modify** plus **Channel Settings: read-only**. Deleted channels are excluded from totals, navigation, and restore destinations. Snapshot creation intentionally fails instead of saving an incomplete restoration manifest when a required catalog or metafield endpoint is unavailable.

Snapshot payloads contain catalog data and public image links, but never BigCommerce access tokens. Snapshot names define case-insensitive, per-user version series; each row is uniquely identified by name and snapshot version, metadata is indexed separately for fast navigation, and no retained payload is overwritten. Publication is opt-in and limited to one version per owner/series; unpublishing immediately removes cross-tenant access. Product capture resolves BigCommerce channel assignments first, then loads only the assigned product IDs. Reads are serialized per store and use BigCommerce quota/reset headers for proactive throttling and automatic 429 retries.

Large snapshot captures are initialized once, checkpointed in Turso, and processed in retryable 30-product Workflow steps before an atomic finalization transaction creates the immutable snapshot version. Closing the browser, navigating away, an individual Function timeout, or a deployment does not discard completed batches. A capture with no server heartbeat for ten minutes is marked failed instead of remaining permanently active, and its name becomes available for another attempt.

Restoration is cross-store and cross-channel. It maps category hierarchy by URL slug and products by any matching SKU or product slug. Existing matched products keep their attributes, variants, images, metadata, and stock; restore only associates them with the snapshot categories and destination channel. Missing products are created in full, including mapped brands, tax classes, option/value IDs, variants, images, catalog metadata, aggregate product/variant inventory levels, category links, and channel assignment. Location-specific Inventory API balances and reservations are not captured. Restoration is additive: categories, products, variants, and channel assignments absent from the snapshot are preserved.

BigCommerce does not provide a transaction spanning the complete catalog restore. If an API request fails, the destination can be partially updated; the error remains visible in the modal and rerunning the same immutable snapshot continues the deterministic reconciliation. Metafields owned privately by a different API client can still be rejected by BigCommerce. Review the selected environment/channel carefully and take a fresh snapshot before restoring when you need a manual rollback point.

## Local development

Node.js 20.19 or newer is required. Clerk credentials are required; the database can use a local SQLite file for development.

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

Without Turso variables, local development creates `local.db` in the project directory. To use Turso, add the Marketplace integration and pull the updated environment:

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

The app creates or migrates the `notes` table and creates the `bigcommerce_environments`, `catalog_snapshots`, `catalog_snapshot_events`, `catalog_operations`, and snapshot-capture staging tables on the first authenticated request. All application queries use tenant-aware indexes and user-scoped predicates. Snapshot events preserve version-deletion audit records, while operation rows persist background status, Workflow run IDs, progress, results, warnings, and errors. Notes created before authentication was added are preserved with no owner and remain hidden until an explicit ownership migration assigns them.

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
