# Prompt History

This file records user prompts and implementation summaries in reverse chronological order. Dates use the project timezone, Europe/Paris.

## 2026-07-20 — Add graceful offline recovery

### Prompt

> Is it possible to have some kind of better offline error page when I stop the server, and reload the right page once it's started again?
>
> perfect, working fine

### Summary

- Added a generic service-worker-cached server-unavailable shell that appears for failed document navigations after one successful application load.
- Preserved the exact requested application URL while offline, probed the server every 2.5 seconds, and automatically reloaded that route when the Next.js server returned.
- Kept authenticated pages, RSC responses, API payloads, credentials, and catalog data out of the offline cache.
- Converted catalog-operation progress polling connection failures into quiet transient retries instead of an unhandled Next.js development error overlay.
- Verified the fallback by stopping the local server, reloading a nested environment route, restarting the server, and observing automatic restoration of that same page.

## 2026-07-20 — Refine the Operations table layout

### Prompt

> in operations, keep the progress column same width (cut text if necessary)
>
> can you improve the table layout, maybe put date and time on two lines?

### Summary

- Retained a fixed allocation for the progress/result column and truncated long current-step labels with their complete value available as a tooltip.
- Applied a stable table layout and explicit widths across identifiers, operation metadata, targets, progress, update time, duration, and actions.
- Split operation timestamps into stacked date and time lines and vertically aligned the remaining cells for a denser, more readable ledger.

## 2026-07-20 — Resume snapshot capture after a local server restart

### Prompt

> I restarted my local server in the middle of a workflow but it's not continuing and stay stalled
>
> I've restarted a new workflow. Should I restart the server to test?
>
> Looks like it's working, you can document, branch, commit, merge and push!
>
> got this error after restarting the server. 32 products were captured when I restarted
>
> It's running a I can see it in Operations, but the progress bar don't show up in the Channel page
>
> (and icons are not disabled) Also in the trace: ... UNIQUE constraint failed ...
>
> in operations, keep the progress column same width (cut text if necessary)

### Summary

- Confirmed that the local Workflow backend could retain an orphaned in-flight HTTP step after `next dev` stopped, even though the snapshot's Turso checkpoint remained intact.
- Added a development-only recovery guard that detects active operations last updated before the current server process, atomically claims recovery, cancels the superseded Workflow run, and starts a replacement run for the same operation.
- Recovered the exact local `run not found` case from the same Turso capture state, confirming the replacement run continued beyond the saved 32-product cursor instead of restarting the capture.
- Limited failed-run recovery to the latest operation for each operation key and treated concurrent unique-index claims as an unsuccessful recovery rather than failing the shared operations API.
- Reordered operation reconciliation ahead of stale-run expiry and kept development snapshot operations available for immediate recovery rather than prematurely marking them failed.
- Restored channel-page progress, activity state, and disabled actions by keeping historical failures from returning a 500 in the global operation feed.
- Gave the Operations progress/result column a fixed table allocation and ellipsized long product-step descriptions while retaining their full text as a tooltip.
- Verified a real capture retained all 211 category checkpoints and continued from product 32 through subsequent 30-product batches after restarting the local server.

## 2026-07-20 — Checkpoint category capture batches

### Prompt

> my last capture looks stuck...
>
> Can you implement it?

### Summary

- Traced the stalled capture to the original Workflow initialization step, which fetched every category metafield before creating its first durable capture-state checkpoint.
- Persisted the source channel, category tree, raw category records, category cursor, and initialization state before category enrichment begins.
- Split category enrichment into retryable 10-category Workflow steps so worker restarts resume from the last saved batch, then retained the existing retryable 30-product batches and atomic version finalization.
- Added backward-compatible staging-table migrations, initialization guards, exact category progress, and updated the documented Workflow diagram.

## 2026-07-20 — Prioritize favorite Restore channels

### Prompt

> is it possible to have a yellow star, same color as the icon?
>
> channel dropdown can also show the fav channel at the top with an icon

### Summary

- Switched native Restore favorite markers to the yellow `⭐` symbol so they match the favorite action color.
- Added per-user channel favorite metadata to Restore destinations, sorted favorite channels first within each environment, and marked them in the Channel selector.

## 2026-07-20 — Mark favorite snapshots in Restore

### Prompt

> Great but I don't see the favorite icon on the left of the snapshot name. I can see the one for the published version

### Summary

- Added per-user snapshot favorite state to the Restore snapshot-series selector.
- Sorted favorite snapshot series first and displayed a leading favorite star beside their names, while retaining the blue globe exclusively for published versions.

## 2026-07-20 — Prioritize favorite restore destinations and distinguish publication

### Prompt

> when choosing a destination, move the favorite envs at the top with a small fav icon on the left of the name. change all the publish icon with something else than a star to avoid confusion with fav. it should also be blue in the version selection dropdown. change the icon application wide for published

### Summary

- Added environment favorite metadata to Restore destinations, sorted favorite environments first, and marked them with a leading favorite star in the destination selector.
- Replaced the application-wide published star with a blue globe icon so publication and favorites have distinct visual meanings.
- Updated the native snapshot-version selector to use a blue globe marker for published versions.

## 2026-07-20 — Move channel status into card footers

### Prompt

> in the channel listing, remove the "View catalog" link in the card, and replace by the status tag "Active", "Prelaunch" in the card view, ...

### Summary

- Removed the redundant **View catalog** footer link from channel cards while retaining catalog navigation through each channel title.
- Moved each channel's Active, Prelaunch, or other status badge into the bottom-right footer position.
- Left the favorite control alone in the card's top-right corner for a cleaner and more consistent card hierarchy.

## 2026-07-20 — Align toolbar favorite controls

### Prompt

> That doesn't seem very aligned...Should we use the same kind of button for the favorite action as the other ones?

### Summary

- Changed compact Catalog and Snapshot favorite actions from circular controls to the same rounded-rectangle silhouette used by adjacent toolbar buttons.
- Preserved the exact 24-pixel icon-only size and amber favorite state while leaving favorite controls on cards circular.

## 2026-07-20 — Standardize catalog action controls at 24 pixels

### Prompt

> Let's make all of these buttons in Catalog and Snapshot view 24 pixels

### Summary

- Standardized every Catalog and Snapshot page toolbar action to an exact 24-pixel height.
- Kept the compact 10-pixel labels and 9-pixel action icons aligned with the existing 24-pixel favorite control.
- Applied the shared dimensions to capture, restore, clear, create-version, inspect, choose-version, history, and delete actions without changing modal controls.

## 2026-07-20 — Clear stale activity indicators globally

### Prompt

> Even after a task has been finished, activity monitor is still there in the different pages until I can to the detail page where I can see the progress bar "completed" before it disappear.

### Summary

- Connected the authenticated layout's global operation observer to the browser's active-operation state so terminal workflows clear activity indicators without requiring a channel or snapshot detail-page visit.
- Cleared completed, failed, and cancelled tasks only when their operation ID matches the locally tracked task, preventing a late result from dismissing a newer workflow.
- Refreshed the current route after global cleanup so Dashboard, environment, channel, and snapshot surfaces immediately reconcile their server-derived state.

## 2026-07-20 — Fix notification-panel stacking

### Prompt

> Looks like there is some zindex issue with the notification pop up which should be above

### Summary

- Moved the persistent notification panel into a document-body portal so the sidebar's backdrop-filter stacking context can no longer place page content above it.
- Preserved its visual relationship with the bell by calculating a fixed viewport position on open and updating it during scrolling and resizing.
- Extended outside-click detection across both the sidebar bell and portaled panel.

## 2026-07-20 — Anchor toast notifications to the page

### Prompt

> Maybe toat notifications would be better at the top right on the page

### Summary

- Moved the transient toast layer through a document-body portal so it is consistently fixed to the page viewport's top-right.
- Kept the notification bell and persistent inbox in the sidebar while preventing its backdrop filter from becoming the toast positioning context.

## 2026-07-20 — Add a global notification center

### Prompt

> Let's add a notification icon (where would be the best place) that can show latest notifications, and a way to remove them with a little x icon. When displaying a notificaation in a pop-over, it should be automatically removed after 30 seconds. all notifications will go in that notification panel when clicking the notification icon (with a bade with number of notifications awaiting to be deleted), with a delete all action in the panel

### Summary

- Placed a global notification bell in the authenticated sidebar header, keeping it reachable in both expanded navigation and the collapsed icon rail.
- Added a badge showing the number of retained operation notifications and an accessible popover with recent completion, failure, and manual-action details plus direct resource links.
- Added individual × deletion and a **Delete all** action while retaining inbox entries until explicit cleanup.
- Split transient and persistent behavior: new notifications still appear as dismissible popups that expire after 30 seconds, while the per-user inbox persists locally and synchronizes across browser tabs.

## 2026-07-20 — Expand collapsed-shell card grids

### Prompt

> When menu is collapsed, I think we can go up to 4 columns for the card views

### Summary

- Expanded Dashboard environments, Settings environments, channel lists, and snapshot-series card grids to four columns on wide screens when the user's global sidebar is collapsed.
- Applied the same responsive rule to card-mode loading skeletons so loading and loaded layouts remain aligned.
- Preserved the existing live and captured product grids, which already use their own denser five-column layout.

## 2026-07-20 — Make sidebar collapse global and refine action sizing

### Prompt

> Instead of making it per page preference, make the menu collapse global per user... icons and buttons display is still wrong

### Summary

- Moved sidebar collapse persistence to one tenant-scoped `app-shell` preference shared by every authenticated page, while carrying forward an existing collapsed page choice for users who had already saved one.
- Kept card/table and shared-snapshot preferences scoped by page type and continued exposing the active page's saved view mode to its loading skeleton.
- Returned snapshot and channel detail toolbars to a compact visual scale with smaller labels, icons, padding, and a dedicated 24-pixel favorite control.

## 2026-07-20 — Match skeletons to persisted list mode

### Prompt

> Skeletons are not working as expected anymore. For lists, it should display a list skeleton, but displays a card skeleton all the time

### Summary

- Fixed streamed and prefetched loading boundaries so they no longer depend on a client context lookup that can temporarily fall back to card mode.
- Exposed the current page type's persisted display mode on the authenticated app shell and made loading skeleton variants respond synchronously through CSS.
- Kept both card and compact-table skeleton structures lightweight and available to the route boundary while displaying only the saved page-type variant.

## 2026-07-20 — Refine product tables, actions, and page width

### Prompt

> can you adjust columns sizes so there is no horizontal scroll in the products table?

> Also, buttons sizes have chnaged are doens't look as good as before, Maybe it's because of the favorite button which should be smaller?

> Also can you generalize the full width + menu collaspe implemented in the Operations table, but with a button arrow (and persist that preferences for each user, per page type)?

### Summary

- Removed the shared table's forced minimum width from live and captured product browsers and assigned fixed percentage widths to Product, Description, Categories, and Price, with wrapping and line clamping to keep the table within its catalog panel.
- Reduced card favorite controls to a 28-pixel circle and detail-page favorites to 24 pixels so they do not increase the compact action row's perceived height.
- Added an accessible desktop arrow control that toggles the application between its full navigation and a full-width icon rail on every page.
- Persisted one global sidebar state per user through a reserved application-shell preference, independent from the page-type collection display preferences.

## 2026-07-20 — Persist collection display preferences

### Prompt

> Can you persist each list / card / shared snapshots view preferences for each user?

> When in list mode, skeleton should also show a list skeleton, not cards skeleton

> Card / list / toggle preferences are not per catalog, snapshot, etc. but per page type only!

### Summary

- Added tenant-scoped Turso collection preferences keyed by Clerk user and stable collection identifier.
- Persisted card/table selection independently by page type: Dashboard, Settings, environment channel lists, Snapshots, live channel catalogs, and captured snapshot catalogs. Preferences do not vary by individual environment, channel, or snapshot.
- Persisted the Snapshots shared-series visibility choice while keeping search text transient.
- Server-rendered each collection in its saved initial state and used authenticated Server Actions for subsequent updates, avoiding cross-tenant reads and reload-time layout flicker.
- Added preference-aware loading states so Dashboard, channel, snapshot, and live/captured product collections use compact skeleton rows in table mode and card placeholders in card mode.

## 2026-07-20 — Add searchable card and table collection views

### Prompt

> Everywhere we display cards, add a tool bar above (aligned right, same icon and button size as in Catalog or Snapshot pages) where we can switch between cards view, and compact table view (same compactness as Operations table). Also add a Search box aligned left to quickly filter elements. For Snapshots, also add an icon to show / hide shared Snapshots

### Summary

- Added a reusable accessible collection browser with left-aligned instant search, result counts, and right-aligned 32-pixel card/table controls.
- Added compact table views to Dashboard environments, Settings environments, channel lists, snapshot series, and live/captured product browsers while retaining their existing cards and actions.
- Added a Snapshots-only visibility control for shared read-only series; owned snapshots and active captures remain visible.
- Kept API, database work, cards, and table rows in Server Components; only the toolbar and its display controls cross the client boundary.

## 2026-07-20 — Refine favorite and publication controls

### Prompt

> Move the blue star showing published version on the left of the titles. Also add a favorite icon button on the left of all buttons in catalog snapshot, channel catalog pages. Favorite icons on cards should be top right

> move the blue star at the end of the title, inline

> move the Remove link to bottom right of the card. move the status of the env at the bottom right of the card

### Summary

- Positioned the blue publication marker inline at the end of snapshot titles on both the snapshot list and snapshot detail page.
- Added the tenant-scoped favorite toggle as the leftmost action on snapshot and channel catalog detail pages.
- Kept resource-card favorite controls consistently positioned as the sole top-right control.
- Moved Settings-card removal controls and Dashboard connection statuses into the bottom-right card footer, leaving the favorite star as the sole top-right control.

## 2026-07-20 — Add favorites to resource cards

### Prompt

> Add Favorites feature on Environments, Snapshots, Channels with a small star icon easy to set/unset, so favorite items appear first in the different lists

### Summary

- Added a tenant-scoped Turso favorites table and authenticated Server Action for environment, channel, and accessible snapshot-series toggles.
- Added compact accessible star controls with immediate optimistic feedback to Dashboard, Settings, channel, and Snapshots cards.
- Sorted favorites first while retaining alphabetical channel/environment ordering and the existing snapshot publication/name ordering within favorite and non-favorite groups.
- Made snapshot-series favorites survive new immutable versions and follow series renames; deleted environments and snapshot series clean up their related favorite keys.

## 2026-07-20 — Improve the channel listing

### Prompt

> Can you improve the channels page with same 3 columns layout, and a bit more details about the channel?

### Summary

- Changed each environment's channel listing to the same responsive one-, two-, and three-column card layout used by Dashboard and Snapshots.
- Added labeled channel and site IDs, status, platform and type, merchant UI visibility, product-listing availability, primary storefront URL, and the latest available channel date.
- Preserved ascending channel-name ordering, one storefront URL per channel, catalog navigation, and channel-specific activity indicators.

## 2026-07-20 — Add row shortcuts and notification expiry

### Prompt

> Double clicking on a row, open details. Add a timeout of 30 seconds for notifications

### Summary

- Made non-interactive areas of every Operations row open the existing details modal on double-click while preserving the dedicated Details and Open controls.
- Added independent absolute 30-second expiry timers to background-operation notifications without changing manual dismissal, resource links, or persisted seen-operation behavior.

## 2026-07-20 — Expand Operations and collapse its navigation

### Prompt

> Can you add version published, version unpublished, version deleted, environment added, environment deleted, snapshot deleted in the list of operations? Can you also minimize the left panel with pages, with only icons so operations table can take more space?

### Summary

- Unified durable catalog operations with tenant-owned snapshot lifecycle events, including publish, unpublish, version deletion, and rename records.
- Added an application audit stream for environment addition/deletion and whole snapshot-series deletion, written atomically with mutations and retaining only safe resource metadata.
- Extended operation filtering, sorting, table rows, and detail views for lifecycle records while preserving progress displays for background Workflows.
- Collapsed the desktop sidebar to an accessible icon rail only on Operations and removed the usual shell width limit so the compact table can use the wider viewport.

## 2026-07-20 — Add the Operations activity ledger

### Prompt

> Let's create a Operations page which lists in a compact and detailed, sortable and filtarable table, the list of current and previous operations (like the history on environment and snapshots)

### Summary

- Added a tenant-scoped Operations route and sidebar item covering current and previous snapshot capture, restore, and catalog-clear Workflow records.
- Added a compact responsive table with search plus type, status, environment, attention, and date filters; sortable identifiers, operation, status, target, snapshot, progress, update time, and duration columns; and visibility-aware refresh while work is active.
- Added a Restore-style detailed modal with persisted progress, exact current step, result counters, restore sections, warnings, errors, validated manual actions, technical identifiers, and direct affected-resource links.
- Added loading feedback and documented the Operations data boundary and user experience in README and DETAILS.

## 2026-07-20 — Release credential diagnostics

### Prompt

> Perfect, you can branch, commit, merge into main and push

### Summary

- Finalized the documentation and release records for BigCommerce credential diagnostics, the Restore-style report modal, and responsive environment cards.
- Created `feature/credential-diagnostics`, verified and committed the implementation, merged it into `main`, and pushed the updated main branch.

## 2026-07-20 — Add credential diagnostics and three-column environment cards

### Prompt

> let's add 9. Better credential diagnostics. In Settings, add “Test access” with a scope report: Available operations; Missing scopes; B2B availability; APIs unavailable for that store/channel type.
>
> Can we also make the environment cards on 3 columns like for env and snapshots?
>
> Test access should display the result in a nice modal window

### Summary

- Added tenant-scoped, read-only BigCommerce endpoint probes that classify verified capabilities, inferred missing read scopes, invalid credentials, rate limits, and APIs unavailable for a specific store or channel type without exercising destructive write permissions.
- Added operation-level readiness, explicit unverified modify-scope requirements, and B2B Edition detection across active channels.
- Added a pending **Test access** action and an accessible, responsive scope-report modal rendered through a body portal with the same viewport shell as Restore, plus focus restoration, Escape/backdrop dismissal, detailed probe results, and a **View report** action.
- Changed saved environment cards to a responsive three-column layout and widened the Settings content area while keeping edit and credential controls tenant scoped.

## 2026-07-20 — Release global completion notifications

### Prompt

> Perfect you can branch, commit, merge and push

### Summary

- Finalized documentation and release records for global completion, failure, and manual-action notifications.
- Created `feature/completion-notifications`, verified and committed the implementation, merged it into `main`, and pushed the updated main branch.

## 2026-07-20 — Add global background-operation notifications

### Prompt

> let's implement 5. Completion notifications. Show an in-app notification when a background operation completes, fails, or needs manual action—even if the user navigated elsewhere. Include a direct link back to the affected channel or snapshot.

### Summary

- Added a tenant-scoped recent-operation feed that reconciles active durable Workflow runs and exposes completion, failure, affected-resource, and manual-action summary data.
- Mounted a global notification stack in the authenticated layout so snapshot capture, restore, and clear results remain observable after navigating away from their originating page.
- Added per-user terminal-event deduplication, visibility-aware polling, success/failure/manual-action presentation, dismiss controls, and direct links to the affected snapshot or channel.

## 2026-07-20 — Release the visual preflight comparison

### Prompt

> Perfect you can document, branch, commit, merge and push

### Summary

- Finalized the visual Snapshot → Destination preflight comparison documentation and release changelog.
- Verified the feature, committed `feature/preflight-comparison`, merged it into `main`, and pushed the updated main branch.

## 2026-07-20 — Add a visual restore preflight comparison

### Prompt

> Let's improve pre-flight: Visual preflight comparison. Show “Snapshot → Destination” differences in a compact table: New, matched, skipped, and conflicting records; existing versus new assignments; store-wide changes; manual actions required.

### Summary

- Replaced the preflight metric cards with a compact, responsive Snapshot → Destination comparison table for category and product totals, creates, matches, destination-only preserved records, and structured conflicts.
- Added a dedicated existing/new channel-assignment comparison plus concise store-wide/mixed-scope impact and manual-action summaries.
- Kept warnings and blocking conflicts visually distinct, and extended the server preflight model to calculate preserved destination records and conflicting source records directly instead of inferring them from warning text.

## 2026-07-20 — Release the restore wizard UX

### Prompt

> you can doc, branch, commit, merge and push. then Let's improve pre-flight

### Summary

- Finalized documentation for the guided restore wizard, split Snapshot and Version selectors, published-version indicator, and clarified Continue action.
- Created `feature/restore-wizard-ux`, verified the complete change set, committed it, merged it into `main`, and pushed the updated main branch before beginning the next preflight improvement.

## 2026-07-20 — Clarify the restore-sections action

### Prompt

> in this step the "Run restore preflight" should be "Continue" instead

### Summary

- Renamed the restore-sections primary action to **Continue**, matching its role in advancing the three-step wizard.
- Preserved the existing behavior that starts preflight while opening the review step, where its loading state and results are shown.

## 2026-07-20 — Split snapshot and version restore selectors

### Prompt

> To select the snapshot version, maybe we should use two dropdowns, one for Snapshot, second for Version (with publish icon if needed)

### Summary

- Replaced the combined snapshot/version restore selector with separate Snapshot and Version dropdowns in the restore wizard.
- Scoped the Version choices to the selected owner/name series, selected its newest version when changing snapshots, and marked published versions with a star and label.
- Preserved restore-section defaults, preflight invalidation, destination selection, and typed confirmation when switching versions.

## 2026-07-20 — Convert snapshot restore into a guided wizard

### Prompt

> I'd like to implement 1

### Summary

- Reorganized Snapshot Restore into three focused steps: destination, restore sections, and preflight review with typed confirmation.
- Added a responsive progress header, navigation back to completed steps, a non-scrolling action footer, and step-specific validation without changing the existing Server Actions or durable Workflow launch.
- Preserved preflight invalidation and server-side revalidation, improved the destination-impact explanation, and added accessible focus movement and pending states across wizard transitions.

## 2026-07-20 — Release durable catalog workflows and restore preflight

### Prompt

> you can doc branch commit merge and push

### Summary

- Updated the project documentation and changelog for durable snapshot restore and catalog clear Workflows, restore preflight, pending-state feedback, and validated Workflow diagrams.
- Created `feature/durable-catalog-workflows`, verified the complete change set, committed it, merged it into `main`, and pushed the updated main branch.

## 2026-07-19 — Document durable Workflow execution diagrams

### Prompt

> Using mermaid cli is it possible to document the 3 workflows with start / end and all steps in DETAILS?

### Summary

- Added Mermaid flowcharts for snapshot capture, snapshot restore, and catalog clear to `DETAILS.md`, including start/end states, loops, every registered step, retry limits, and failure paths.
- Clarified that restore and clear share one branched Workflow and that cancellation is external run control rather than a `"use step"` function.
- Rendered all three diagrams successfully with Mermaid CLI 11.16.0 to validate their syntax.

## 2026-07-19 — Show restore preflight pending state

### Prompt

> When clicking on Run restore preflight, disable the button and show a spinner until the results come back

### Summary

- Connected the preflight button to its Server Action pending state, disabling repeat submissions while the request is running.
- Added an accessible busy state, animated spinner, and **Running preflight…** label until the preflight result returns.

## 2026-07-19 — Add durable restore and clear workflows with restore preflight

### Prompt

> Let's do durable restore and clear workflows and then restore preflight

### Summary

- Replaced request-lifetime `after()` execution for restore and clear with registered Vercel Workflow runs whose IDs, status, progress, results, and cancellation remain persisted in Turso.
- Added retryable restore-group and clear steps, generic Workflow reconciliation, and durable cancellation so navigation, reloads, deployments, and Function restarts do not restart an operation from the browser.
- Added a read-only restore preflight that revalidates access and the destination, reports catalog matches/creates and channel assignments, inventories selected configuration resources, surfaces warnings and manual work, and blocks ambiguous SKU/slug matches.
- Required a current successful preflight before typed confirmation in the UI and repeated the same validation on the server immediately before starting restoration.

## 2026-07-19 — Document the Turso database schema

### Prompt

> Can you document the database schema in a mermaid block using mermaid cli?

### Summary

- Added a Mermaid entity-relationship diagram to `DETAILS.md` covering all seven Turso/libSQL tables, their columns, and their application-level relationships.
- Documented Clerk's external ownership model, the absence of SQL foreign keys, and the schema's important uniqueness and active-operation constraints.
- Validated the diagram syntax by rendering it with Mermaid CLI.

## 2026-07-19 — Move implementation details out of README

### Prompt

> move the long text rom README.md to a DETAILS.md file

### Summary

- Created `DETAILS.md` and organized the existing security, BigCommerce scope, snapshot, configuration, durable-processing, and restoration reference under focused headings.
- Replaced the long README reference block with a concise link and added `DETAILS.md` to the project-records list.

## 2026-07-19 — Preserve destination contact email

### Prompt

> Don't sync the email from the Contact information

### Summary

- Removed `store_email` from the writable Storefront profile allowlist so snapshot restoration cannot replace the destination channel's contact email.
- Retained email capture for settings inspection while continuing to restore the contact display name, address, and phone.

## 2026-07-19 — Handle empty customer groups and image-logo uploads

### Prompt

> Warning: customer groups: Unexpected end of JSON input
> Warning: Logo settings: BigCommerce rejected logo settings: Invalid Input. Fields missing in the input.

### Summary

- Made optional BigCommerce capture parse successful empty response bodies as `null` instead of throwing an end-of-JSON error, and normalized an empty customer-groups response to an empty collection.
- Suppressed the known empty-response warning when restoring already-created immutable snapshots that captured it before the parser fix.
- Stopped sending image-logo state through the text-logo Settings endpoint, which rejects image-only payloads as missing fields.
- Retained non-empty textual logo restoration through the JSON Settings API and image logo/favicon restoration through their dedicated multipart upload endpoints.

## 2026-07-19 — Capture and restore effective storefront settings

### Prompt

> You can override all these storefront settings

### Summary

- Added a dedicated opt-in Storefront settings snapshot group, separate from inspect-only channel, site, route, domain, and integration configuration.
- Captured the effective source-channel values for contact information, logo/favicon, SEO, robots.txt, product/category display, catalog preferences, inventory rules, search, status messages, and customer privacy by resolving channel overrides against inherited global settings.
- Restored those values as explicit destination-channel overrides with writable field allowlists, customer-group ID remapping by name, BigCommerce-CDN asset validation, and best-effort logo/favicon uploads.
- Excluded generated prelaunch passwords, global-only product-filtering state, invalid empty textual logos, and non-writable launch/prelaunch channel state.
- Removed customer privacy from the general experience capture for new snapshots so selecting both Storefront settings and Checkout experience cannot overwrite the effective privacy restore with inherited null values; older snapshots remain compatible.
- Verified every JSON settings endpoint, customer privacy, and favicon upload against `rezakalfane` channel `1881648`; all writable requests returned HTTP 200.

## 2026-07-19 — Sanitize default tax-zone restoration

### Prompt

> Regarding tax restoring: Warning: Tax zone Default Zone: BigCommerce rejected tax zone Default Zone: The default zone cannot have any locations or customer groups attached to it. Please remove these fields from the default zone update request and try again.

### Summary

- Confirmed from BigCommerce's Tax Rates and Zones API documentation that the default zone cannot accept `shopper_target_settings`, which contains its immutable locations and customer groups; live verification also confirmed its `enabled` status is immutable.
- Removed the complete nested targeting object and enabled flag from default-zone update payloads while retaining captured targeting for ordinary tax zones and compatibility cleanup for older snapshot shapes.
- Mapped an existing destination default zone before its best-effort metadata update, allowing tax-rate reconciliation to continue even if BigCommerce rejects another editable zone field.

## 2026-07-19 — Map and restore translations independently

### Prompt

> Warning: 102 products translation records could not be applied because its catalog resource was not mapped in the destination.
>
> Warning: 52 categories translation records could not be applied because its catalog resource was not mapped in the destination. Product and categories traductions have bbeen loaded. Fix the import in rezakalfane

### Summary

- Identified that a Localization-only restore had empty source-to-destination ID maps, causing every captured translation record to be skipped before the BigCommerce mutation.
- Added a read-only destination catalog reconciliation pass that maps products by SKU or slug and categories by URL path or hierarchy.
- Made translation restoration independent from selecting Catalog, while reusing and supplementing mappings from Catalog restoration when both sections are selected.
- Preserved warnings for genuinely ambiguous or missing destination resources instead of applying translations to an uncertain match.
- Verified all 51 products and 26 categories from version 6 map uniquely to `rezakalfane` channel `1881648`; the snapshot contains 50 Spanish product translations and 26 Spanish category translations.
- Attempted the live replay, which BigCommerce rejected before writing any translation because the currently saved destination token lacks permission for `updateTranslations`; documented the required Content modify (`store_content`) scope and retained the original History warnings until replay succeeds.
- Improved GraphQL restore warnings to include BigCommerce's actual permission or validation message, and stopped counting untranslated audit rows as unmapped translation records.

## 2026-07-19 — Skip redundant default-locale updates

### Prompt

> Got Warning: Channel locales: BigCommerce rejected default locale en. maybe because it was already default

### Summary

- Confirmed the restore was sending an unnecessary default-locale mutation even when the destination channel already used the captured locale.
- Made locale restoration idempotent by reading the destination's current default and skipping the mutation when it already matches.
- Retained default-locale updates when a newly added or existing destination locale genuinely needs to become the default.

## 2026-07-19 — Restore channel country and missing locales

### Prompt

> When restoring localization, push default country to channel, add missing locales to destination channel

### Summary

- Captured the source channel's effective default country, falling back to the global store country when the channel inherits it.
- Restored the country through the channel-scoped Store Locale endpoint instead of changing the destination store globally.
- Loaded the destination channel's current locale list, added only captured locales that were missing, preserved unrelated locales, and enforced BigCommerce's five-locale limit.
- Applied the captured default locale after missing locales were reconciled.
- Verified the channel-country request and destination-locale query shapes against the authorized `rezakalfane` environment.

## 2026-07-19 — Reset the restore modal after starting an operation

### Prompt

> After a snapshot has been restored, if I click on Restore again, I don't see all the options, dropdown, restore confirm and button... I have to refresh the page!

### Summary

- Cleared stale server-action feedback whenever the Restore Snapshot modal is opened for a new operation.
- Restored the snapshot/version selector, destination controls, categorized options, confirmation input, and submit button without requiring a page reload.
- Reset the typed confirmation and restore selections to the safe defaults for the active snapshot on every new modal session.

## 2026-07-19 — Make Channel & storefront settings inspect-only

### Prompt

> Remove Channel and Storefront when restoring a snapshot, this can mess up the destination configuration for Makeswift and URL

### Summary

- Removed Channel & storefront from the snapshot restore modal while retaining its captured data in Inspect settings.
- Rejected the channel restore group during server-side form and operation parsing so stale clients cannot submit it.
- Added a second guard in configuration restoration to prevent destination channel properties, metafields, sites, or routes from being applied even if an internal caller bypasses request parsing.
- Documented that Makeswift integration, URLs, routes, domains, and checkout ownership remain destination-managed.

## 2026-07-19 — Log payment-configuration visibility as a manual restore action

### Prompt

> have the restore log a manual action linking to Payments → Manage Channel Visibility.

### Summary

- Added a structured manual action to completed Pricing & currencies restores when the snapshot contains currency assignments.
- Logged the restored currency codes and destination channel, with guidance to assign the intended payment configuration such as Test Payment Provider.
- Rendered a validated, clickable Control Panel link in channel and snapshot History without storing or reusing Control Panel cookies or XSRF credentials.

## 2026-07-19 — Restore missing store currencies and channel visibility

### Prompt

> Now let's fix adding currency if needed (global to store), add channel visibility, associate currencies to channel being restored. Use rezakalfane env to test things until it works

### Summary

- Verified against `rezakalfane` that BigCommerce accepts creation of missing transactional currencies through the V2 store Currency API.
- Created EUR globally from the VitaChem source definition, then associated EUR visibility and default currency only with the Allen Edmonds FR-CA destination channel.
- Accounted for BigCommerce automatically exposing a newly created global currency to inheriting channels by capturing and restoring every non-destination channel's previous assignment.
- Preserved support for captured store-currency definitions and added a default-currency reconstruction path for older snapshots.
- Confirmed the final live state: USD remains the store default, EUR exists globally, Allen Edmonds FR-CA is EUR-only/default EUR, and the three unrelated live channels remain USD-only/default USD.

## 2026-07-19 — Scope restored shipping methods to the destination channel

### Prompt

> Instead of adding all channels to a shipping method, just add the channel being processed to the existing list

### Summary

- Assigned newly created shipping methods only to the channel selected as the restore destination.
- Preserved every existing method-to-channel assignment and appended only the destination channel when updating a method.
- Avoided automatically exposing restored shipping methods to unrelated active or prelaunch storefronts.

## 2026-07-19 — Repair rejected shipping-zone restoration

### Prompts

> Setting shipping zone still doesn't work

> You can use env rezakalfane to test any endpoint

### Summary

- Diagnosed the latest live restores against the authorized `rezakalfane` environment and verified that the United States zone existed but its Flat rate method had not been created.
- Confirmed BigCommerce rejects the captured read-only `is_fallback` property on shipping-method writes, then removed it from restore payloads.
- Confirmed BigCommerce rejects updates to the existing global zone, then reused that immutable zone container while still reconciling its methods, rates, enabled state, and channel assignments.
- Improved V2 error extraction so array-shaped BigCommerce API errors retain their actionable message in restore warnings.
- Verified the corrected minimal payload by creating the missing United States Flat rate method with the captured rate and all four live storefront channels.

## 2026-07-19 — Assign restored shipping methods to every storefront

### Prompt

> Regarding shipping: zone United States has been added correctly, Rest of the World was already existing. With multi storefront, when adding a shipping method, channels should be specified. Let's add all channels when restoring shipping zones and methods.

### Summary

- Loaded every active or prelaunch storefront channel in the destination environment before reconciling shipping zones.
- Explicitly supplied all destination storefront channel IDs when creating or updating every restored shipping method.
- Preserved global-zone reconciliation so an existing Rest of the World zone is reused rather than duplicated.

## 2026-07-19 — Reconcile snapshot configuration warnings

### Prompt

> Can you go through these warnings: Currency assignments rejected because EUR was not enabled; price-list variant IDs differed; Rest of the world shipping zone was rejected; the default tax zone and deprecated tax display setting were rejected; inventory locations and active theme were unavailable; and catalog translations were not applied.

### Summary

- Enabled existing destination currencies before channel assignment, captured source store-currency definitions for future snapshots, and created missing display-only currencies when the API permits it while retaining an actionable warning for transactional currencies that require Control Panel setup.
- Remapped price-list records through reconciled variant SKUs/base variants and remapped Catalyst product/category translations through their restored destination IDs.
- Sanitized shipping-zone location IDs, reconciled global zones by type, removed forbidden location/customer-group fields from the default tax zone, and migrated the retired tax control-panel display boolean to the current display-strategy enum.
- Corrected inventory-location capture to `/v3/inventory/locations` and stopped requesting an active Stencil theme for Catalyst channels.

## 2026-07-19 — Preserve automatic related products during restore

### Prompts

> If product has no related product, option "Automatically show related products" should be checked

> [-1] array value might be the one needed for automatic related products

### Summary

- Preserved BigCommerce's `related_products: [-1]` sentinel instead of discarding it during source-to-destination product ID mapping.
- Restored automatic related products when the snapshot contains no manual relationships or no manual relationship can be mapped to a destination product.
- Kept explicit related-product selections mapped to their destination product IDs when available.

## 2026-07-19 — Sort restore snapshots and identify published versions

### Prompt

> Can you order the dropdown by name ascending and version descending? also indicate with an icon the versions that are published

### Summary

- Ordered snapshot restore options alphabetically by snapshot name and newest version first within each name.
- Marked published versions with a star icon and an explicit Published label in the native selector.
- Preserved the selected snapshot and manifest-aware restore settings while changing only the selector presentation order.

## 2026-07-19 — Show only captured settings during restore

### Prompt

> In the restore modal, can you only show settings that exist in the selected snapshot for selection?

### Summary

- Derived available restore sections from each immutable snapshot manifest and displayed only captured sections in the restore modal.
- Updated the available choices immediately when selecting another snapshot version from a Channel page.
- Enforced the same manifest-aware allowlist on the server so configuration absent from a snapshot cannot be submitted manually.

## 2026-07-19 — Capture B2B data only for B2B-enabled channels

### Prompt

> Don't capture B2B settings if the site is not B2B enabled, like BigGear B2C snapshots shouldn't have B2B settings

### Summary

- Checked the selected channel through the B2B Management API before loading any store-wide B2B records.
- Captured Companies, users, roles, and business data only when the channel explicitly reports `b2bEnabled: true`.
- Omitted the B2B configuration group entirely for B2C, unregistered, or inaccessible channels and exposed the decision in capture progress.

## 2026-07-19 — Rename snapshot series inline

### Prompt

> In a snapshot page, it should be possible to update the Snapshot name by double clicking on it, and editing it inline

### Summary

- Added an accessible inline snapshot-name editor for owned snapshots, opened by double-click or keyboard and saved with Enter.
- Renamed the complete immutable version series and its activity history while preserving publication state and version identifiers.
- Prevented duplicate names and renaming during an active capture, recorded the rename in Snapshot history, and refreshed published snapshot names for other users in real time.

## 2026-07-19 — Keep snapshot completion navigation scoped to its launch page

### Prompt

> Once a capture is finished, open that version in the UI only if user is already in the right channel or snapshot where it was started from

### Summary

- Persisted the channel or snapshot route that launched each capture in the browser's catalog-operation state.
- Opened the newly created immutable version only when capture completes while the user is still on that exact launch route.
- Enabled completion navigation for channel-launched captures and preserved the existing new-version behavior for snapshot-launched captures.
- Prevented server-refreshed progress components from overwriting a locally retained launch route after users navigate elsewhere.

## 2026-07-19 — Capture and restore B2B Edition demo data

### Prompts

> Can you also capture B2B settings that can be captured and applied using BigCommerce B2B API (B2B category when restoring)?

> Please include all Customer/Business records, hierarchies, companies, users, quotes, orders, data as we are managing demo environments

### Summary

- Added an opt-in, store-wide **B2B Edition** snapshot and restore category using the standard BigCommerce access token with the B2B Management API store-hash header.
- Captured custom Company permissions and full role definitions plus Companies, users, addresses, hierarchy relationships, shopping lists and items, quote details, B2B order records, invoices, payments, attachment metadata, sales representatives, and extra-field definitions.
- Added additive restore reconciliation for custom permissions and roles, Companies, users, addresses, Company hierarchies, and shopping lists with source-to-destination Company, user, role, channel, and product ID mapping.
- Preserved quotes, orders, invoices, payments, attachment binaries, sales-representative identities, and extra-field definitions as inspectable audit data when the B2B API cannot replay them faithfully or would automatically notify buyers; restore surfaces explicit warnings instead.
- Documented B2B read/modify scope requirements and warned that creating Companies or users may trigger BigCommerce account or welcome email.

## 2026-07-19 — Inspect captured snapshot settings

### Prompt

> Add a button in the Snapshot page to inspect those settings that have been captured

### Summary

- Added an **Inspect settings** action to owned and published read-only Snapshot detail pages.
- Added an accessible modal that groups captured configuration by the same categories used during restore, identifies channel/site/store scope, and expands each resource into formatted captured data and any capture warning.
- Loaded potentially large configuration only when requested through a Clerk-protected, snapshot-authorized, non-cached endpoint instead of adding it to every Snapshot page response.
- Applied a defense-in-depth secret-field redaction before captured configuration reaches the browser and added a compatibility message for older catalog-only versions.

## 2026-07-19 — Capture and selectively restore channel configuration

### Prompts

> Looking at the BigCommerce API, what aspect of a Channel can be snapshoted and restored? Shipping config, tax config, more?

> Can you add all these in capture, but make them optional through checkboxes (categorize settings) in restore?

### Summary

- Extended new snapshot manifests with best-effort captures for channel/storefront metadata, channel metafields, sites/routes, checkout/cart/customer/order/abandoned-cart settings, currencies, assigned price lists and records, channel and store-wide shipping, tax settings/zones/rates/classes, inventory settings/locations, Catalyst locales and translations, non-secret channel-script metadata, and active-theme configuration metadata.
- Kept required catalog capture strict while recording missing optional scopes or unavailable APIs as per-resource warnings so one optional setting cannot invalidate a large durable capture.
- Added categorized restore checkboxes for Catalog, Channel & storefront, Checkout & customer experience, Pricing & currencies, Shipping, Tax, Inventory & locations, and Localization & presentation; Catalog is selected by default and all configuration is opt-in.
- Persisted selected groups with the background restore operation and added best-effort reconciliation for portable settings, price-list definitions/assignments, shipping zones/methods, tax zones/rates/settings, locales, and theme activation.
- Marked store-wide groups visibly, retained destination domains/SSL, excluded provider credentials and secrets, and surfaced mapping-sensitive omissions as non-fatal restore warnings.
- Preserved compatibility with older catalog-only manifest versions and verified TypeScript, ESLint, and the optimized Next.js/Workflow production build.

## 2026-07-19 — Add application screenshot to documentation

### Prompt

> commit documentation update

### Summary

- Added the supplied full-resolution application overview screenshot to `docs/images`.
- Embedded the screenshot near the top of the README and recorded the documentation-only commit in the changelog.

## 2026-07-19 — Fix snapshot Workflow startup failure

### Prompts

> The snapshot capture from the Vercal app is stuck at the very beginning and doesn't start

> [Activity log screenshot showing the latest Mulberry Demo snapshot capture remaining queued]

### Summary

- Queried the Vercel Workflow backend and confirmed the queued catalog operation had a corresponding run that failed in about 100 milliseconds with `ReferenceError: require is not defined` before its first step.
- Traced the exception to Workflow's deterministic VM loading Turso/libSQL's native `@neon-rs` loader because orchestration, Node.js steps, and server-side run creation shared one module dependency graph.
- Split deterministic orchestration, Node.js catalog steps, and server-side Workflow dispatch into separate modules so the flow bundle contains no libSQL, sqlite3, native loader, or database updater code.
- Added Workflow-status reconciliation so early platform failures become visible as failed catalog operations instead of remaining queued, and made catalog cancellation cancel the underlying durable run.
- Verified TypeScript, lint, whitespace, optimized production build, generated Workflow routes and step registrations, and the absence of Node-native dependencies from the generated flow bundle.

## 2026-07-19 — Make large snapshot captures durable and resumable

### Prompts

> Got a snapshot capture in progress on Vercel, but it's stuck and doesn't progress anymore. I just closed the browser on my laptop but it's supposed to work on the server, right?

> Stalling again at 888

### Summary

- Confirmed from Vercel runtime logs that two captures were killed at the platform's 300-second Function limit, first at product 848 and then at product 888 of 1,522; closing the browser was not the cause.
- Replaced snapshot capture's single `after()` callback with Vercel Workflow DevKit orchestration and retryable 30-product server steps that survive individual Function limits, browser closure, navigation, restarts, and deployments.
- Added Turso staging state and idempotent product-batch checkpoints, plus atomic finalization so retries cannot create duplicate snapshot versions.
- Stored Workflow run IDs on catalog operations, preserved per-product progress, retained cancellation checks, and added automatic failure recovery for snapshot operations with no heartbeat for ten minutes.
- Excluded Workflow's internal routes from Clerk proxy protection, documented Vercel's zero-configuration Workflow provisioning, and blocked the legacy single-invocation snapshot runner.

## 2026-07-19 — Prevent concurrent snapshot captures with the same name

### Prompt

> Can you enforce that there can't be two snapshot captures with the same name. Some modal bug allowed it to happen

### Summary

- Added a database-enforced, per-user uniqueness guard for queued and running snapshot captures using a normalized snapshot-name operation key.
- Prevented duplicate captures across modal submissions, repeated clicks, tabs, browsers, and concurrent server requests while retaining deliberate version creation after the active capture finishes.
- Normalized snapshot-name whitespace before conflict lookup and persistence, and returned a specific actionable error when the same named capture is already active.

## 2026-07-18 — Handle Ably subscription cleanup safely

### Prompt

> got this from the open snapshots page on another browser

### Summary

- Fixed the React Strict Mode race where effect cleanup closed Ably while its asynchronous channel subscription was still attaching.
- Marked disposed subscriptions before teardown so the expected Connection closed rejection is ignored instead of triggering the Next.js error overlay.
- Kept unexpected realtime failures non-fatal with a warning while the focus, visibility, and 30-second fallback refresh path remains active.

## 2026-07-18 — Add live snapshot publication updates

### Prompts

> How can we setup some push events so other users UI are updated live, for instance when a new snapshot is published, users in the snapshots page can see that appear.

> Ok let's implement it

### Summary

- Added optional Ably Pub/Sub integration while retaining Turso as the authoritative snapshot store.
- Added a Clerk-protected token endpoint issuing one-hour, subscribe-only capabilities for the global published-snapshots channel.
- Published compact snapshot.published and snapshot.unpublished invalidation events after successful database mutations, including automatic unpublication when switching versions.
- Added a Snapshots-page realtime subscriber that debounces events into `router.refresh()` calls, plus focus, visibility, and 30-second fallback refreshes.
- Kept the feature operational without `ABLY_API_KEY`; realtime connections are skipped and fallback refresh remains active.
- Documented local and Vercel configuration and kept the Ably server API key out of client bundles.

## 2026-07-18 — Identify publishers and sort cards by name

### Prompt

> in Snapshots, when a published read-only snapshot is displayed, also display the owner email who published it, to know where it's coming from. List published snapshots first in the list of snapshots (ordered by name). Rest of snapshots are also ordered by name. in Dashboard, env are ordered by name for now..

### Summary

- Added the publishing owner's primary Clerk email to read-only shared snapshot cards, resolving only the distinct owners represented on the current page.
- Sorted published snapshot series first by name, followed by unpublished/private series sorted by name.
- Added an explicit final case-insensitive name sort to Dashboard environments after asynchronous BigCommerce metrics load.

## 2026-07-18 — Audit snapshot publication changes

### Prompt

> Publish and Unpublish events should be added to the history log with details

### Summary

- Persisted tenant-scoped Published and Unpublished audit events with snapshot name, version, ID, source environment/channel, catalog counts, payload size, and event time.
- Added publication events to snapshot History in descending chronological order alongside creation, restore, deletion, and other snapshot activity.
- Publishing a different version records the automatic unpublication of the previous version before recording the newly published version.
- Avoided duplicate audit entries for no-op publish or unpublish requests.

## 2026-07-18 — Disable deletion for published versions

### Prompt

> You can't delete a published version. disable the delete button in this case. Version first needs to be unpublished before you can delete it

### Summary

- Disabled Delete version for any currently published snapshot version, matching the existing server-side deletion protection.
- Added accessible explanatory text indicating that the version must be unpublished before deletion becomes available.

## 2026-07-18 — Slightly larger page action buttons

### Prompt

> you can make these buttons slighlt bigger

### Summary

- Increased channel and snapshot page action triggers to 11px labels with slightly wider gaps, `px-3 py-1.5` padding, and medium-small radii.
- Kept Choose version's per-version Publish, View, and Delete controls at their smaller 10px scale.

## 2026-07-18 — Compact snapshot version actions

### Prompt

> use the same small button label icon size

### Summary

- Matched Publish, Unpublish, View version, and Delete version to the compact 10px label/icon scale used by snapshot header actions.
- Reduced padding, gaps, radii, and line-height while retaining full keyboard focus and disabled states.
- Added matching version and trash icons to the View and Delete actions for consistent visual treatment.
- Fixed the global form-control font shorthand that overrode Tailwind font sizes on buttons, ensuring button and link actions now render at the same declared scale.

## 2026-07-18 — Publish snapshot versions across users

### Prompt

> In the choose you can publish one of the version of the snapshot. Snashot with a published version have a published icon next to the title. A published version can be unpublished. When a snashot has a publised version, it appears on other's Snapshots list as readonly (no new version or take snapshot on it possibility), with only the published version visible, and can be used by other users to restore to one of their channels. published snapshots have a blue border in the snapshots page, with the same published icon next to their name (no create new version, no choose version, no history, no delete button displayed on others accounts)

### Summary

- Added owner-only Publish and Unpublish controls to each entry in Choose version, with at most one published version per snapshot series.
- Added blue published icons, badges, and card borders to published snapshot series.
- Included published snapshots in other authenticated users' Snapshots index and channel restore selector while exposing only the published immutable version.
- Rendered shared snapshot details as read-only with Restore Snapshot as the only mutation control; private versions, creation, version selection, History, publishing, and deletion remain owner-only.
- Enforced the same access boundary in Turso queries and restore execution so direct URLs and Server Action calls cannot expose unpublished or owner-only snapshot data.
- Protected published versions and series from deletion until the owner explicitly unpublishes them.

## 2026-07-18 — Make header actions visibly smaller

### Prompt

> buttons are not smaller...

### Summary

- Reduced snapshot and channel header controls again to a visibly compact 10px label/icon scale.
- Applied 4px vertical and 8px horizontal padding, tight line-height, and compact corner radii so the resulting button footprint is materially smaller.

## 2026-07-18 — Protect the viewed snapshot version

### Prompt

> Update: we can't delete a selected version for viewing, but you can delete the others, including the latest

### Summary

- Choose version now hides deletion only for the version currently selected for viewing.
- Any other version, including the latest version, can be deleted with the existing confirmation flow and audit event.
- Server validation confirms that the protected viewed version and deletion target belong to the same tenant-owned snapshot series.
- Deleted version numbers remain reserved when calculating the next version, preventing a deleted latest version number from being reused.

## 2026-07-18 — Disable actions on active catalog surfaces

### Prompt

> Disable action buttons when an action is in progress in the same channel / or same snapshot

### Summary

- Added a reactive catalog-operation scope hook synchronized through local storage and operation-change events.
- Take snapshot, Restore Snapshot, and Clear catalog disable only when their channel has an active operation.
- Create new version, Restore Snapshot, Delete snapshot, and older-version deletion disable only when their snapshot has an active operation.
- History and Choose version remain available so users can inspect activity and retained versions while background work continues.

## 2026-07-18 — Log snapshot-version deletions

### Prompt

> I don't want to add the Delete version button, I just want to log the fact that a version has been deleted

### Summary

- Removed Delete version controls and their confirmation UI from snapshot History.
- Older versions remain deletable only from Choose version.
- Successful version deletions now write a durable tenant-scoped audit event containing the deleted snapshot name, version, ID, source environment/channel, catalog counts, and deletion timestamp.
- Snapshot History merges retained versions, restore operations, and deletion audit events in descending date order.

## 2026-07-18 — Delete snapshot versions from History

### Prompt

> Snapshot version deletion can be added to snapshot history

### Summary

- Snapshot History now provides a Delete version action on each older immutable version entry.
- Deletion uses the existing confirmation modal pattern and server-side latest-version protection.
- Deleting the version currently being viewed navigates to the latest retained version; deleting another older version refreshes History in place.

## 2026-07-18 — Smaller snapshot and channel buttons

### Prompt

> Can you make these buttons smaller (smaller font, smaller button)

### Summary

- Reduced snapshot and channel header action labels to 11px and icons to 12px.
- Tightened button padding, icon gaps, and corner radii without changing modal confirmation controls or metadata tags.

## 2026-07-18 — Compact snapshot and channel action rows

### Prompt

> In snapshot page and channel page, move the buttons below the title, subtitle and tags, aligned to the right, make also the icons smaller (also smaller font), use icon button or icon  + label button where it nakes the most sense and if it's easy to understand

### Summary

- Snapshot and channel headers now render title/subtitle first, metadata tags second, and a dedicated right-aligned action row underneath.
- Header actions use consistent compact sizing with 14px icons, 12px labels, reduced padding, and tighter gaps.
- Primary, versioning, history, restore, and destructive actions retain concise labels alongside their icons to avoid ambiguous or risky icon-only controls.

## 2026-07-18 — Immediate new-version progress and navigation

### Prompts

> When creating a new version, I don't immediately see the progress bar, I have to navgate out and back to the snapshot page

> Also when the new version capture is finished, switch to that snapshot

### Summary

- New-version captures are now associated with the open snapshot immediately, so the shared progress bar appears as soon as the confirmation modal closes.
- Refreshed server operation props are synchronized back into the mounted progress component instead of requiring navigation away and back.
- Operation status responses now expose the created snapshot ID; successful new-version captures clear the operation marker and navigate directly to the newly created snapshot version.

## 2026-07-18 — Create a new version from snapshot details

### Prompt

> In a snapshot page, add a "Create new version" action that will trigger a Take snapshot using the env/channel from the last version. display a confirm modal with the details

### Summary

- Snapshot detail pages now expose a Create new version action using the named series' latest version as the authoritative source, even when an older version is being viewed.
- The confirmation modal shows the snapshot name, current-to-next version, source environment/channel, catalog counts, and latest capture date.
- Confirmation queues the existing persisted background capture workflow with the latest version pre-authorized, preserving every previous version and showing the shared progress after the modal closes.

## 2026-07-18 — Snapshot names and versions in channel history

### Prompt

> In channel history, show more than snapshot ID: snapshot name and version would be better

### Summary

- Channel History now resolves each tenant-owned snapshot reference and displays its name, version, and ID for both capture and restore operations.
- History summary lookup avoids loading large snapshot manifest payloads.
- New restore results persist the snapshot name and version so future History entries remain descriptive even if their source snapshot is later deleted.

## 2026-07-18 — Detailed snapshot capture progress

### Prompt

> When capturing snapshot, it only shows "Loading channel, categories, products, and store metadata", can you give more details in the progress bar?

### Summary

- Snapshot progress now identifies the source channel and assigned category tree.
- Category capture reports each category name and its position in the category set while retrieving metadata.
- Product capture reports assignment discovery, product-record batches, and each product name with variant and image counts while retrieving product and variant metadata.
- Supporting store metadata, manifest totals, and the newly saved snapshot version are persisted as final progress steps.

## 2026-07-18 — Retry rate-limited snapshot captures

### Prompt

> Snapshot captured
> Jul 18, 2026, 8:23 PM
> failed
> Snapshot: Test 2
> Failed
> BigCommerce rate limit reached. Try the snapshot again shortly.

### Summary

- Snapshot API reads are now serialized per store to prevent concurrent product and variant metadata requests from exhausting the BigCommerce quota.
- Capture requests inspect BigCommerce rate-limit headers, pause proactively near quota exhaustion, and retry HTTP 429 responses with reset-aware exponential backoff.
- A capture only fails with a rate-limit error after the expanded automatic retry window is exhausted.

## 2026-07-18 — Channel-scoped snapshots and deletion

### Prompt

> Last snapshot tookl an unusual long time. it captures the whole store catalog and not only the products in the snapshoted channel! (Test 2) so we have 577 products instead of just 51 in the original channel. add a delete snapshot button, and also a delete version for other than current versions

### Summary

- Snapshot capture now reads BigCommerce product/channel assignments and fetches full product data only for product IDs assigned to the selected channel.
- Snapshot detail pages now provide a typed-confirmation Delete snapshot action that permanently removes the complete tenant-owned snapshot series and all versions.
- Choose Version now allows permanent deletion of older versions with a confirmation modal, while both the UI and database protect the latest version.

## 2026-07-18 — Show pending snapshot captures

### Prompt

> Can we also see snapshot in progress in Snapshots, with the progress bar. If it's cancelled, remove it and if the user was on the snapshot page, go back to snapshots

### Summary

- The Snapshots index now queries persisted queued/running capture operations and renders them as in-progress cards with the shared server-backed progress bar.
- Cancelling a capture marks the operation cancelled, removes its pending card after refresh, and prevents the runner from overwriting cancellation with completion.
- Existing snapshot detail pages detect an active capture for the same snapshot series; cancelling there redirects to `/snapshots`.

## 2026-07-18 — Continue restore after item errors

### Prompt

> Log errors but don't stop the whole import process and continue to the next items. Also investigate what could have been wrong there.

### Summary

- Product-level restore failures are now collected as warnings while subsequent products, related-product updates, and channel-assignment batches continue.
- Operations finish as completed-with-warnings and retain each warning in History instead of failing the entire restore.
- Investigation showed the affected snapshot product had no product metafields, but restore still made an unnecessary metafield request immediately after product creation; empty metafield collections are now skipped.
- Metafield writes now exclude response-only fields such as `resource_type`, `resource_id`, ownership, IDs, and timestamps.

## 2026-07-18 — Product-level restore progress

### Prompt

> When displaying "Creating and updating products, variants, images, and metadata" in progress bar, also show what's being created

### Summary

- Restore progress now names the current product and identifies whether it is being created or reused.
- New-product steps show variant and image counts while attributes and metadata are restored.
- Existing-product steps show category assignment and queued channel assignment while confirming preserved catalog data.
- Final progress reports channel-assignment batches and created/assigned totals.

## 2026-07-18 — Exclude terminated storefront channels

### Prompt

> For env rezakalfane I see 16 channels where there should be 4

### Summary

- Verified that BigCommerce returns 16 storefront channel records for the environment, including 12 terminated Catalyst storefronts.
- Dashboard counts, environment channel lists, and restore destinations now include only storefront channels with `active` or `prelaunch` status, matching the four storefronts visible in the control panel.

## 2026-07-18 — Count assigned products as restored updates

### Prompt

> Snapshot restored should show product updated as they were assigned to channel and categories

### Summary

- Existing products receiving restored channel/category assignments are now counted as updated without changing their catalog attributes.
- Older completed fast-restore history entries infer the updated count from the captured snapshot product count when the stored result reported zero.

## 2026-07-18 — Channel and snapshot activity history

### Prompt

> When looking at a channel, add an History button to access the history of Taking snapshot, Restoring snapshot and Clearing catalog with details? Same on a Snapshot, show History of Snapshot creation, update, restore with details

### Summary

- Added an accessible History modal to channel pages, scoped to the exact environment/channel and showing snapshot, restore, and clear operations.
- Added snapshot-series History combining immutable version creation/update records with restore operations.
- History entries include status, timestamps, destination/result counts, current steps, and persisted errors.
- Completed snapshot operations now retain the created snapshot ID for durable audit association.

## 2026-07-18 — Persist snapshot capture in the background

### Prompt

> apply the pattern to take snapshot

### Summary

- Snapshot capture now persists its operation before closing the modal and runs through the server scheduler, so navigation and reloads do not cancel the capture request.
- Existing-name/version confirmation is resolved before queuing the background job.
- Capture progress is stored in Turso across catalog loading, manifest saving, and completion, with background errors surfaced by the shared progress UI.

## 2026-07-18 — Fast restore for existing products

### Prompt

> in restore snapshot, don't update existing products, but just assign them to the channel, place them in the right categories and skip the rest of the attributes / variants / metadata. It will restore faster when products exist

### Summary

- Existing products matched by SKU or slug are now preserved and receive only snapshot category links and the destination channel assignment.
- Existing product attributes, variants, images, modifiers, related products, and metadata are not updated.
- Products absent from the destination are still fully created from the snapshot.
- Reduced destination product matching data to variants-only while retaining SKU and slug matching.

## 2026-07-18 — Repair snapshot restore execution

### Prompt

> can you also make the restore snapshot work?

### Summary

- Removed the modal click handler that could unmount the restore form before its Server Action executed.
- Persist restore operations first and schedule their runner server-side so navigation or reloads cannot cancel the worker request.
- Pass the authenticated tenant explicitly into background restoration and publish durable category, product/variant/image/metadata, and verification phases to the shared progress bar.

## 2026-07-18 — Repair Clear catalog execution and progress

### Prompt

> Check code, clearing DOES NOT work at all, progress bar DOES NOT work either

### Summary

- Found that closing the confirmation modal during the click event unmounted the form before its Server Action executed; the UI then displayed a local-only progress marker although no operation or BigCommerce request existed.
- Start clear only after the Server Action has persisted an operation, and schedule its runner on the server so navigation cannot cancel the work.
- Drive progress, completion, and errors from the persisted Turso operation, including real product/category batch steps.
- Verified the BigCommerce mutation against Test channel 1: 51 product assignments and 26 categories were removed, with zero remaining afterward; products were preserved.

## 2026-07-18 — Verify Clear catalog mutations

### Prompt

> doesn't look that categories are removed in BC and products are unassigned in BC. Control panel shows the same numbers, nothing is removed during the clear process which is very slow by the way

### Summary

- Increased Clear catalog mutation batches to the BigCommerce limit used by the API.
- Added post-delete verification for product-channel assignments and category-tree contents.
- Clear now reports an explicit scope/filter failure instead of claiming success when BigCommerce leaves records behind.
- Reduced unnecessary inter-batch delay while retaining 429 backoff and a short eventual-consistency wait before verification.

## 2026-07-18 — Reflect Clear catalog state immediately in the browser

### Prompt

> update UI when categories and products are unassaigned (without reloading the catalog, just update the UI)

### Summary

- Added a client-side clear-state synchronizer scoped to the active environment/channel.
- The live category and product browser now visually transitions into a clearing state immediately when unassignment begins, while the server operation continues in the background.

## 2026-07-18 — Scope activity indicators to the active surface

### Prompt

> status indicator and progress bars appear in too many places. It should only appear in the selected channel / env / snapshot

### Summary

- Scoped operation progress to the target environment/channel.
- Scoped restore activity to the selected snapshot version.
- Unrelated Dashboard cards, channel cards, and snapshot pages no longer show another surface’s active operation.

## 2026-07-18 — Show named catalog operation steps

### Prompt

> Show the exact steps in the progress bar (the product being assigned, unassigned, the category being created or removed, etc.)

### Summary

- Progress state now accepts named category and product work items.
- Restore displays named category/product restoration steps; Clear catalog displays named category removal and product unassignment steps.
- Snapshot detail and channel pages use the same step-aware progress component.

## 2026-07-18 — Show activity indicators in dashboards and channel lists

### Prompt

> I would lke to see that activity indicator also in the channel listing page and the dashboard

### Summary

- Added the shared animated catalog-operation badge to Dashboard environment cards.
- Added the same badge to environment headers and channel-list cards.

## 2026-07-18 — Add operation cancellation and activity indicators

### Prompt

> Add a cancel button at the bottom right of the progress bar section to cancel an action. When an action is in progress, show some animated icons in the channel box or environment box or related snapshot box

### Summary

- Added a shared Cancel control to the full-width operation progress bar.
- Added animated activity badges beside channel and snapshot titles while an operation is tracked.
- Cancel immediately stops client-side progress polling and clears the active operation marker.

## 2026-07-18 — Reduce progress-refresh rate-limit pressure

### Prompt

> BigCommerce rate limit reached. Try again shortly.

### Summary

- Removed duplicate refresh timers from the individual operation components.
- Reduced shared progress refresh frequency to once every eight seconds.
- Added automatic retry/backoff for channel catalog reads as well as catalog mutations.

## 2026-07-18 — Throttle Clear catalog requests

### Prompt

> BigCommerce rate reached, maybe why clearing doesn't work, should be Throttle

### Summary

- Added automatic 429 retries with exponential backoff and `Retry-After` support to restore/clear BigCommerce mutations.
- Added a small delay between Clear catalog assignment and category batches to reduce burst traffic.

## 2026-07-18 — Unify catalog operation progress across navigation

### Prompt

> Taking snapshot, restoring snapshot and clearing snapshot are exclusive and can't occur at the same time. They all use the same kind of progress bar below the buttons and above the catalog browser. When navigating snapshots, we can also see the progress on taking or restoring a snapshot

### Summary

- Added one shared catalog-operation marker for snapshot capture, restore, and clear actions.
- Enforced mutual exclusion before opening any of the three action dialogs.
- Added one consistent full-width progress bar below channel actions and to snapshot pages, with periodic refresh while active.
- Shared operation state survives page navigation and reloads through browser storage.

## 2026-07-18 — Persist operation progress above the catalog

### Prompt

> Catalog browser should refresh as products are created / assigned to the channel. When clearing a catalog, progress bar should be below the buttons and above the catalog browser, full width. It should also show even if I reload the page during a clear or take snapshot or restore snapshot

### Summary

- Made restore and clear progress indicators full-width rows below channel buttons and above the catalog browser.
- Added periodic catalog refresh while an operation is active so newly assigned products can appear without waiting for the final response.
- Persisted active-operation markers in browser storage so reloading the channel keeps the progress state visible.

## 2026-07-18 — Move operation progress above the catalog

### Prompt

> When clicking on Restore in the modal, close the modal and display the progress bar in the channel page above the catalog browser! Not in the modal

### Summary

- Restore and Clear catalog dialogs now close immediately when submitted.
- Their progress bars render in the channel action area above the catalog browser while the server action continues.
- The catalog refreshes automatically when the operation completes; failures reopen the relevant dialog with the error.

## 2026-07-18 — Add channel operation progress and destination defaults

### Prompt

> When restoring a snapshot from a channel page, prefill Destination env and channel with the right values. Run restore in the background and update product browser at it goes. Display a nice progress bar above the catalog with the current step in progress. Also do the same for Clear catalog action

### Summary

- Channel restore now defaults to the channel and environment currently being viewed.
- Restore and Clear catalog dialogs show staged progress indicators while their server actions run.
- The channel catalog refreshes automatically after each successful operation so product and category browsers reflect the completed change.

## 2026-07-18 — Make snapshot image restoration tolerant of invalid URLs

### Prompt

> BigCommerce rejected images for product 130: The field 'image_url' is invalid. The restore may be partially complete.

### Summary

- Normalized captured image URLs by removing store-generated query strings and rejecting URLs over BigCommerce’s image URL length limit.
- Changed image restore ordering to upload valid images before removing previous product images.
- Rejected image URLs are skipped so one invalid image cannot abort the rest of the catalog restore; the immutable snapshot remains available for retry.

## 2026-07-18 — Add channel restore, snapshot, and clear actions

### Prompt

> Add a restore snapshot button when in a channel, allow to select a snapshot and version. Open a nice modal window to do that. Also open such nice modal window when taking a new snapshot. Then add a Clear catalog button removing categories, and unassigning products to that channel (don't delete products, it will be an option later)

### Summary

- Added a channel-level Restore Snapshot button with snapshot/version selection and the existing destination-aware confirmation flow.
- Converted Take snapshot into a modal dialog.
- Added Clear catalog with typed confirmation; it removes categories from the selected channel tree and unassigns channel products while retaining the products in the store.

## 2026-07-18 — Filter channel catalogs by product assignments

### Prompt

> When navigating to a channel, I sshould only see products that are associated with that channel! I've created a new empty test channel in BigGear Demo and I can see products when openinh it where it should be empty...

### Summary

- Changed the channel catalog loader to resolve BigCommerce product-channel assignments first.
- Product cards are now loaded only for IDs assigned to the selected channel, so an empty channel displays zero products even when the store contains catalog products elsewhere.

## 2026-07-18 — Preserve destination records during restoration

### Prompt

> also don't remove categories that are not in a snapshot during restore, same for products and variants

### Summary

- Changed restoration to preserve destination categories that are not present in the snapshot.
- Removed deletion of destination variants and variant options; matching variants are updated and missing variants are created, while unrelated variants remain.
- Removed cleanup of destination category assignments and channel assignments, so products and assignments outside the snapshot remain intact.
- Updated the restore modal, README, and changelog to describe the additive behavior.

## 2026-07-18 — Allow restoration into any destination channel

### Prompt

> don't restrict to the channel ID as I need to provision new channels with the tool

### Summary

- Confirmed that snapshot source channel IDs are provenance only; they are not used to restrict restoration.
- Restore Snapshot now discovers every reachable non-deleted channel across the logged-in user's saved environments and lets the user select a different destination environment/channel.
- Category, product, variant, image, metadata, hierarchy, and channel-assignment IDs are remapped against the selected destination, allowing a snapshot to provision a newly created channel.
- Kept destructive confirmation, tenant scoping, and explicit partial-restore reporting for the selected destination.

## 2026-07-18 — Show complete catalog-template names

### Prompt

> It's important to see the full name of the snapshot to void confusion, you can move the version number at the bottom right of the card

### Summary

- Removed snapshot-name truncation and allowed long names to wrap naturally across multiple lines.
- Moved the latest-version badge from the card heading to the bottom-right footer so it no longer competes with the snapshot identity.

## 2026-07-18 — Group catalog templates and browse version history

### Prompt

> When listing Catalog templates, don't show separate elements for different versions of the same snapshot, merge them, then when opening a snapshot we can list all versions when clicking on a Restore Snapshot button

### Summary

- Replaced the all-version template query with a tenant-scoped series query that returns the latest capture and retained-version count for each case-insensitive snapshot name.
- Kept the Catalog templates page reverse-chronological while rendering exactly one card per snapshot series.
- Loaded the selected snapshot's complete tenant-scoped version history on detail pages.
- Added an accessible Restore Snapshot modal showing every immutable version, its source environment/channel, capture date, catalog counts, and payload size.
- Linked each historical version back to its catalog preview while leaving destination-store restoration for the next implementation phase.

## 2026-07-18 — Add immutable snapshot versions and name autocomplete

### Prompts

> When trying to save a snapshot with an existing name, ask for confirmation in a nice modal window (showing the existing snapshot details). Increment the snapshot version when saving it, keep the previous ones so it will be feasible to implement a rollback feature

> even better, use autocompletion when entering a snapshot name, allowing to use an existing one (display snapshot name and version and channel in subtitle in the autosuggest panel)

> also restrict the snapshot returned to the same channel id only - like compatible snapshots

> forget the last request and continue, we could overwrite other channels snapshots

### Summary

- Converted snapshot names into tenant-scoped version series with immutable rows and atomic next-version allocation, preserving every previous catalog payload for future rollback.
- Added snapshot-name autocomplete using the latest version of every user-owned series, with version and source-channel subtitles; the final clarification intentionally keeps suggestions available across channels.
- Added a server-authoritative duplicate check that returns the latest snapshot metadata before any BigCommerce capture starts.
- Added an accessible confirmation modal showing source, timestamps, counts, payload size, current version, and the proposed next version.
- Kept stale confirmations safe by requiring the latest snapshot ID; if a newer version appears before confirmation, the modal refreshes with that newer version instead of silently saving.

## 2026-07-18 — Add restoration-ready catalog snapshots

### Prompt

> Add an option to take a Snapshot of the catalog (record metadata like name, creation date, update date - ask for a Snapshot name) in the database: categories will all attributes, products will all attributes with their variants and all attributes, and all metadata fields as well, and all images link. Add a Snapshot item below Dashboard to navigate the different snapshots the same way as products. A Smapshot should be sufficient to re-create products in a Store (or optionally update existing ones) and re-create all categories and products-categories link. Next actions to implement would be "Load Snapshot", "CLear catalog" (with the option to remove all categories as well). I need the tool to manage all my demo environments and be able to easily create catalog templates and load them to new channels / stores.

### Summary

- Added a tenant-scoped `catalog_snapshots` table with unique names, source environment/channel metadata, format version, category/product/variant/image/metafield counts, payload size, full JSON manifest, and creation/update timestamps.
- Added a channel-level naming form and authenticated Server Action that captures the complete manifest before atomically saving and redirecting to the snapshot.
- Captured raw category attributes and hierarchy, category metafields, complete expanded product records, variants and variant metafields, product metafields, options, modifiers, custom fields, pricing rules, videos, all image links, brands, tax classes, and product-category IDs.
- Added Snapshots below Dashboard, a reverse-chronological template-card index, and tenant-protected snapshot detail pages using the same expandable category tree and filtered product grid as live catalogs.
- Added a versioned preview DTO alongside the raw restoration data so browsing remains safe while future restore logic can map all source IDs to destination resources.
- Explicitly deferred Load Snapshot, create-versus-update behavior, Clear catalog, optional category removal, destructive confirmation, and destination ID mapping to the next implementation phase.

## 2026-07-18 — Add interactive category filtering

### Prompt

> Make the tree view expandable / collapsable and also clikcable to list products for a specific category

### Summary

- Replaced the static category list with a focused client component containing accessible expand/collapse buttons and nested tree semantics.
- Added shareable `?category=` links, an All products option, selected-category styling, and automatic expansion of the selected category's ancestor path.
- Added category membership to the safe product DTO and filtered products on the server for the selected category and all of its descendants.
- Disabled category-link prefetching to prevent visible tree links from triggering unnecessary live BigCommerce catalog requests.
- Preserved the existing product-grid column setting while adding category-specific counts, headings, and empty states.

## 2026-07-18 — Fix BigCommerce product image configuration

### Prompt

> Invalid src prop (https://cdn11.bigcommerce.com/s-dsodqqwyls/products/130/images/445/b3-invoice-product-logo__03907.1781714471.386.513.png?c=1) on `next/image`, hostname "cdn11.bigcommerce.com" is not configured under images in your `next.config.js`

### Summary

- Traced the generic Next.js hostname error to the remote pattern's empty-query requirement, which rejected BigCommerce's `?c=1` cache parameter.
- Restricted optimized images to the exact `cdn11.bigcommerce.com` host while allowing its query parameters.
- Documented that the Next.js development server must restart after configuration changes.

## 2026-07-18 — Add channel catalog overviews

### Prompt

> When clicking on a channel, go to a Channel page where you can see an overview of the catalog (tree view on the categories on a left panel, grid of products with image, name, short desc, price in a 6 columns grid)

### Summary

- Made environment channel names and catalog calls-to-action link to a nested dynamic channel route.
- Added tenant-scoped environment lookup and live channel validation so users cannot access another user's credentials or a deleted/unrelated channel.
- Resolved each channel's assigned BigCommerce category tree and rendered its nested categories in a responsive, sticky left panel.
- Loaded channel-filtered products with pagination and rendered optimized images, plain-text short descriptions, calculated prices, and store currency in a six-column wide-screen grid.
- Added a strict BigCommerce CDN image allowlist, request timeouts, parallel category/product loading, independent error states, loading skeletons, empty states, and invalid-route 404 handling.

## 2026-07-18 — Order channels by name

### Prompt

> Order channels by name ascending

### Summary

- Added a reusable server-side channel-name collator with case-insensitive, numeric-aware comparison.
- Sorted the filtered channel DTOs before both Dashboard counting and environment-page site loading, keeping the rendered list consistently ascending.

## 2026-07-18 — Filter deleted channels and duplicate URLs

### Prompt

> There should be only 4 channels for BigGear Demo, and only one URL per channel...

### Summary

- Inspected BigGear Demo's live channel and site responses without exposing its access token.
- Confirmed that the fifth record was a disabled channel with `deleted` status and that every channel site returned primary, canonical, and checkout URL variants.
- Excluded deleted channels from both Dashboard totals and environment detail pages.
- Selected only each channel site's primary URL, with its root URL as a fallback, while preserving HTTP and HTTPS validation.
- Added channel pagination so totals and detail pages remain complete beyond the first API page.

## 2026-07-18 — Add environment channel pages

### Prompt

> In the Dashboard, make environment names clickable. It will go in an environment page, and will list the different channels with name, clickable URLs (new tab)

### Summary

- Made each Dashboard environment name link to its own dynamic detail page while keeping Dashboard highlighted in the application navigation.
- Added a server-only, tenant-scoped environment lookup that requires both the environment ID and authenticated Clerk user ID.
- Loaded the selected store's channels and resolved their site URLs with bounded concurrency and independent per-channel failure handling.
- Added channel cards with names, optional metadata, and validated HTTP or HTTPS storefront links that open safely in a new tab.
- Added loading, empty, API-error, missing-URL, and not-found states without exposing saved BigCommerce access tokens to the browser.

## 2026-07-17 — Publish the environment dashboard

### Prompt

> you can document, branch, commit, merge, push

### Summary

- Finalized README, CHANGELOG, and HISTORY documentation for the live BigCommerce Dashboard and background rendering fix.
- Created `feature/environment-dashboard` and committed the verified implementation.
- Merged the feature branch into `main` with a non-fast-forward merge and pushed `main` to the origin repository.

## 2026-07-17 — Prevent the page background from repeating

### Prompt

> Can you apply the following small fix: body { margin: 0; background: radial-gradient(circle at 15% 0%, rgb(16 185 129 / 8%), transparent 28rem), var(--background); background-repeat: no-repeat; }

### Summary

- Added `background-repeat: no-repeat` to the global `body` rule.
- Preserved the existing radial gradient and background color while preventing vertical repetition.

## 2026-07-17 — Add a live environment dashboard

### Prompt

> Create a Dashboard page above Notes, with a view on the different environments (boxes, 3 columns layout): number of channels, categories, products, variants, ...

### Summary

- Added Dashboard as `/`, moved Notes to `/notes`, and placed Dashboard first in the authenticated sidebar.
- Added a responsive environment-card grid that displays three columns on wide screens.
- Added live Channels, Categories, Products, and Variants totals from current BigCommerce v3 collection endpoints.
- Decrypted each environment token only in the server data layer and returned only safe metric DTOs to the rendered page.
- Added uncached parallel requests, an eight-second timeout, bounded environment concurrency, and independent metric failures so partial scope access remains useful.
- Added connected, partial-data, and unavailable states plus an empty state linking users to Settings.

## 2026-07-17 — Add user-scoped BigCommerce environment settings

### Prompt

> bsack to bc-demoenv, once logged in, app displays a panel on the left with pages and content on the right. Let's create a Settings page where you can add, edit, remove BigCommerce environments with name, store hash, access token. These settings are only for the logged in user (multi tenancy)

### Summary

- Added a shared authenticated route-group layout with a persistent left navigation panel and right-side page content.
- Added Notes and Settings navigation while preserving `/` for notes and introducing `/settings` for BigCommerce environments.
- Added create, edit, and remove flows for environment name, store hash, and access token with validated Server Actions and accessible pending feedback.
- Added a tenant-scoped `bigcommerce_environments` table; every query includes the authenticated Clerk user ID.
- Added AES-256-GCM encryption for access tokens, user-bound authenticated data, masked token hints, and dedicated encryption-key documentation.
- Preserved token secrecy by never returning stored access tokens to the browser and by leaving an existing token unchanged when the edit field is blank.

## 2026-07-17 — Publish passwordless multi-tenant authentication

### Prompt

> Perfect, you can update README, branch, commit, merge into main, push

### Summary

- Finalized README, CHANGELOG, and HISTORY documentation for Clerk passwordless authentication, corporate email-link behavior, and tenant-scoped notes.
- Created `feature/passwordless-multitenant-notes` and committed the verified implementation.
- Merged the feature branch into `main` with a non-fast-forward merge and pushed `main` to the origin repository.

## 2026-07-17 — Fix loading state after abandoning a login link

### Prompt

> I've disabled Require the same device and browser and it's working fine. Just one last bug: when I click on "Choose a different method", I'm back to the home page, but the button shows "Sending..." with a spinning mouse pointer.

### Summary

- Confirmed that disabling Clerk's same-device/browser protection resolved the corporate login-link mismatch and documented the associated security tradeoff.
- Traced the stuck button to Clerk's long-running `waitForVerification()` operation keeping the hook-wide `fetchStatus` in a fetching state after the UI returned to the method selector.
- Replaced the hook-wide loading indicator with explicit short-operation UI state.
- Invalidated abandoned login-link callbacks so an old verification cannot update a newer authentication flow.
- Updated the link instructions to support verification outside the original browser while preserving automatic completion in the waiting page.

## 2026-07-17 — Confirm persistent Clerk client mismatch

### Prompt

> Got the link, [verification URL omitted], but still have the error “This link no longer matches your sign-in” even from the same browser.

### Summary

- Did not store, open, or replay the exposed one-time verification token.
- Confirmed from the token's non-secret redirect metadata that the link originated on `http://localhost:3000`, ruling out a `localhost` versus `127.0.0.1` origin mismatch.
- Verified the project uses Clerk's current Next.js SDK and that the email-link send/wait implementation remains attached to one sign-in resource.
- Isolated the failure to Clerk's same-client cookie check; the safe supported path is an email code, while allowing links without that check requires explicitly disabling Clerk's same-device/browser protection.

## 2026-07-17 — Diagnose same-browser email-link mismatch

### Prompt

> It shows "Open the link in the same browser This link was opened in a different browser profile or private window. Return to the original page, request a new link, and open it in that same browser profile." but I'm in the same browser,

### Summary

- Confirmed that Clerk, rather than the application's verification page, returned the `client_mismatch` result.
- Identified corporate email link inspection as the most likely cause: a mail provider or security scanner can visit the verification URL before the user's browser does.
- Clarified that Clerk matches the link to the still-active authentication attempt, so refreshing the original page, restarting the development server, or requesting another link can also cause a mismatch in the same physical browser.
- Kept same-device/browser protection enabled and documented email codes as the reliable default for Microsoft Outlook and Office 365 users.

## 2026-07-17 — Fix stalled email-link verification status

### Prompt

> [Image #1] Link auth is stalling

### Summary

- Read the screenshot URL and identified Clerk's `__clerk_status=client_mismatch` response, confirming that verification had finished with a browser-context mismatch rather than stalling at Clerk.
- Fixed `/verify` to read Clerk's query-string status as a fallback when the email-link hook does not populate.
- Added explicit verified, expired, failed, and client-mismatch rendering with actionable same-browser guidance.
- Added a Suspense boundary for Next.js-safe `useSearchParams` rendering.
- Re-ran local route verification, lint, TypeScript, the production build, and whitespace validation.

## 2026-07-17 — Replace Clerk transfer with explicit sign-up

### Prompt

> The sign in failed because there is no matching user. Please perform a transfer to sign up.

### Summary

- Determined that the Clerk transfer operation itself remained unreliable for this instance rather than merely being missed at a particular phase.
- Replaced `signUpIfMissing` with Clerk's documented standard flow: attempt sign-in, detect `form_identifier_not_found`, then create a normal sign-up and send its email verification code.
- Made login-link attempts for unknown users switch automatically to code-based sign-up, matching the requested authentication behavior.
- Added support for both Core 3 direct errors and nested Clerk API error arrays.
- Re-ran lint, TypeScript, the production build, and whitespace validation.

## 2026-07-17 — Handle early Clerk transfer responses

### Prompt

> I still get The sign in failed because there is no matching user. Please perform a transfer to sign up.

### Summary

- Confirmed from Clerk's Frontend API error reference that the message maps to `sign_up_if_missing_transfer`.
- Identified that Clerk can return the transfer response while creating or sending a factor, before the verification handler used by the previous fix.
- Added transfer handling to sign-in creation, email-code delivery, email-link delivery, and verification.
- Added an explicit sign-up-owned code path that sends and verifies the code through `signUp.verifications` when transfer happens before email verification.
- Re-ran lint, TypeScript, the production build, and whitespace validation.

## 2026-07-17 — Fix new-user sign-up transfer

### Prompt

> local error: The sign in failed because there is no matching user. Please perform a transfer to sign up.

### Summary

- Diagnosed the message as Clerk completing email verification for a new identifier but returning a transferable sign-in state that was not matched by the existing error-code check.
- Updated the verification handler to use Clerk's stable `signIn.isTransferable` state, with the documented error code retained as a fallback.
- Re-ran lint, TypeScript, the production build, and whitespace validation.

## 2026-07-17 — Support email codes and login links

### Prompt

> sign-up can use code, it's ok. then sign in can be done using link or code

### Summary

- Added a delivery-method selector offering email codes or login links.
- Made email codes work as a privacy-preserving combined sign-up/sign-in flow through Clerk's `signUpIfMissing` transfer.
- Preserved the same-browser login-link flow that signs in the waiting original tab automatically.
- Added code verification, resend, start-over, loading, validation, and missing-requirement handling.
- Updated the setup documentation to use email-code verification for sign-up and both email-code and email-link verification for sign-in.

## 2026-07-17 — Add passwordless authentication and tenant isolation

### Prompt

> Perfect, let's add an auth layer to bc-demoenv: users can login using only an email (enforce @bigcommerce.com or @commerce.com emails), send an email with a code/login link, users are logged automatically (you can close this window, and the original page is logged in). Have user dependant Notes in the database so we get a multi tenant setup

### Summary

- Added a custom Clerk email-link sign-in flow that waits in the original tab, completes the session automatically after verification, and lets the verification tab be closed.
- Enforced exact `@bigcommerce.com` and `@commerce.com` email domains in the form, in protected server code, and through Clerk's wildcard domain allowlist.
- Added protected routing, denied-access handling, and sign-out controls.
- Added the authenticated Clerk user ID to note writes and every note read/delete predicate for tenant isolation.
- Added a safe schema migration that preserves pre-authentication notes as unassigned rows while hiding them from all tenants.
- Provisioned and connected Clerk through the Vercel Marketplace, pulled its development keys, and documented the remaining Clerk email-link configuration.
- Verified the implementation with ESLint, TypeScript, and a production build.

## 2026-07-17 — Retry template publication with GitHub authentication

### Prompt

> gh CLI is now logged in as rezakalfane-bigcommerce, you can try

### Summary

- Retried the GitHub operations with the authenticated account.
- Published `rezakalfane-bigcommerce/nextjs-tailwind-turso-template` with `main` as its default branch.
- Verified that the private repository is enabled as a GitHub template and carries Next.js, Tailwind CSS, Turso, libSQL, and Vercel topics.

## 2026-07-17 — Create a separate reusable starter repository

### Prompt

> keep bc-demoenv as it is, and create a separate nextjs-tailwind-turso-template repository from the current main, clean its historical documentation, enable GitHub’s template setting, and add the Turso-enabled Vercel Deploy Button

### Summary

- Kept the `bc-demoenv` working repository and Git history unchanged.
- Copied the current application into a separate repository with fresh template-oriented documentation.
- Added a Vercel Deploy Button that provisions Turso through the Vercel Marketplace integration.
- Enabled GitHub's template-repository setting after GitHub CLI authentication became available.

## 2026-07-17 — Explain how to turn the project into a template

### Prompt

> How could I createa a template project from the current state? (Next.js + Tailwind + Turso/libSQL)

### Summary

- Explained how to create a clean GitHub template repository from the current source without changing `bc-demoenv`.
- Covered template-safe environment files, local SQLite behavior, Turso Marketplace provisioning, the Vercel Deploy Button, and GitHub's template setting.
- Recommended removing project-specific history and deployment metadata from the reusable repository.

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
## 2026-07-18 — Persisted background catalog operations

- Clear and restore now create durable Turso operation records and return immediately.
- A protected API worker performs the BigCommerce mutations while the client polls status, so navigation and reloads no longer restart the action.
- Progress polling exposes the current server step and cancellation endpoint; clear verifies that product assignments and channel categories were actually removed.
