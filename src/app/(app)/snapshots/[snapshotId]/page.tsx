import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogCategoryTree } from "@/components/catalog-category-tree";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { SnapshotRestore } from "@/components/snapshot-restore";
import { SnapshotVersionHistory } from "@/components/snapshot-version-history";
import { SnapshotVersionDiff } from "@/components/snapshot-version-diff";
import { SnapshotDelete } from "@/components/snapshot-delete";
import { SnapshotCreateVersion } from "@/components/snapshot-create-version";
import { SnapshotSettingsInspector } from "@/components/snapshot-settings-inspector";
import { CatalogHistory } from "@/components/catalog-history";
import { CatalogActivityBadge, CatalogOperationProgress } from "@/components/catalog-operation-progress";
import {
  filterProductsByCategory,
  findCatalogCategory,
} from "@/lib/catalog-filter";
import { getCatalogSnapshotView } from "@/lib/catalog-snapshots";
import { getCatalogRestoreDestinations } from "@/lib/catalog-restore";
import { getSnapshotCatalogHistory } from "@/lib/catalog-history";
import { requireAppUser } from "@/lib/auth";
import {
  getActiveSnapshotOperations,
  getCatalogSnapshotTags,
  getCatalogSnapshotTagSuggestions,
  getFavoriteResourceKeys,
  getSnapshotFavoriteKey,
} from "@/lib/db";
import { PublishedIcon } from "@/components/action-icons";
import { SnapshotInlineName } from "@/components/snapshot-inline-name";
import { FavoriteButton } from "@/components/favorite-button";
import { CollectionBrowser } from "@/components/collection-browser";
import { SnapshotTags } from "@/components/snapshot-tags";
import { CatalogLocaleSelector } from "@/components/catalog-locale-selector";
import {
  ProductInspectorProvider,
  ProductInspectorTrigger,
} from "@/components/snapshot-product-inspector";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatBytes(value: number) {
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function SnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ snapshotId: string }>;
  searchParams: Promise<{
    category?: string | string[];
    locale?: string | string[];
  }>;
}) {
  const [{ snapshotId }, query] = await Promise.all([params, searchParams]);
  const parsedSnapshotId = Number(snapshotId);
  const requestedCategory = Array.isArray(query.category)
    ? query.category[0]
    : query.category;
  const parsedCategoryId = Number(requestedCategory);
  const requestedLocale = Array.isArray(query.locale)
    ? query.locale[0]
    : query.locale;

  if (!Number.isSafeInteger(parsedSnapshotId) || parsedSnapshotId < 1) {
    notFound();
  }

  const [snapshot, restoreDestinations] = await Promise.all([
    getCatalogSnapshotView(parsedSnapshotId, requestedLocale),
    getCatalogRestoreDestinations(),
  ]);

  if (!snapshot) {
    notFound();
  }

  const history = snapshot.isOwner
    ? await getSnapshotCatalogHistory(parsedSnapshotId)
    : [];

  const user = await requireAppUser();
  const [favoriteKeys, activeSnapshotOperations, customTags, tagSuggestions] = await Promise.all([
    getFavoriteResourceKeys(user.id, "snapshot"),
    snapshot.isOwner ? getActiveSnapshotOperations(user.id) : Promise.resolve([]),
    getCatalogSnapshotTags(snapshot.summary.ownerUserId, snapshot.summary.name),
    snapshot.isOwner ? getCatalogSnapshotTagSuggestions(user.id) : Promise.resolve([]),
  ]);
  const isFavorite = favoriteKeys.has(
    getSnapshotFavoriteKey(snapshot.summary.ownerUserId, snapshot.summary.name),
  );
  const activeCapture = activeSnapshotOperations.find((operation) => {
    try {
      const payload = JSON.parse(operation.payloadJson) as { name?: unknown };
      return String(payload.name ?? "").localeCompare(snapshot.summary.name, undefined, { sensitivity: "base" }) === 0;
    } catch {
      return false;
    }
  });
  let activeCaptureOriginPath: string | undefined;
  if (activeCapture) {
    try {
      const payload = JSON.parse(activeCapture.payloadJson) as { originPath?: unknown };
      activeCaptureOriginPath = typeof payload.originPath === "string"
        ? payload.originPath
        : undefined;
    } catch {}
  }
  const publishedVersion = snapshot.versions.find((version) => version.publishedAt);

  const selectedCategory = Number.isSafeInteger(parsedCategoryId)
    ? findCatalogCategory(snapshot.categories, parsedCategoryId)
    : null;
  const products = filterProductsByCategory(
    snapshot.products,
    selectedCategory,
  );
  const priceFormatter = new Intl.NumberFormat(snapshot.activeLocale ?? "en", {
    style: "currency",
    currency: snapshot.currency,
  });
  const basePath = `/snapshots/${snapshot.summary.id}`;
  const latestVersion = snapshot.versions.reduce((latest, version) =>
    version.snapshotVersion > latest.snapshotVersion ||
    (version.snapshotVersion === latest.snapshotVersion && version.id > latest.id)
      ? version
      : latest,
  snapshot.versions[0] ?? snapshot.summary);

  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-10">
      <div className="mx-auto w-full max-w-[1320px]">
        <Link
          href="/snapshots"
          className="inline-flex rounded-sm text-sm font-medium text-black/45 transition hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:text-white/45 dark:hover:text-emerald-300"
        >
          ← Snapshots
        </Link>

        <header className="mt-7 border-b border-black/10 pb-7 dark:border-white/10">
          <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Catalog snapshot
              </p>
              <div className="mt-2 flex min-w-0 items-center gap-3">
                {snapshot.isOwner ? (
                  <SnapshotInlineName
                    key={snapshot.summary.name}
                    snapshotId={snapshot.summary.id}
                    name={snapshot.summary.name}
                    published={Boolean(publishedVersion)}
                  />
                ) : (
                  <h1 className="min-w-0 break-words text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                    {snapshot.summary.name}
                    {publishedVersion ? (
                      <><PublishedIcon className="ml-2 inline-block align-[-0.08em] text-blue-600 dark:text-blue-300" /><span className="sr-only"> Published snapshot</span></>
                    ) : null}
                  </h1>
                )}
                <CatalogActivityBadge snapshotId={snapshot.summary.id} />
              </div>
              <p className="mt-3 text-sm text-black/45 dark:text-white/45">
                {snapshot.summary.sourceEnvironmentName} ·{" "}
                {snapshot.summary.sourceChannelName}
              </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {[
              `${snapshot.summary.categoryCount} categories`,
              `${snapshot.summary.productCount} products`,
              `${snapshot.summary.variantCount} variants`,
              `${snapshot.summary.imageCount} images`,
              `${snapshot.summary.metafieldCount} metafields`,
              formatBytes(snapshot.summary.payloadBytes),
              `Snapshot version ${snapshot.summary.snapshotVersion}`,
              ...(publishedVersion ? [`Published version ${publishedVersion.snapshotVersion}`] : []),
              `Manifest format v${snapshot.summary.formatVersion}`,
            ].map((value) => (
              <div key={value} className="rounded-full border border-black/10 bg-white/60 px-3 py-1.5 text-xs text-black/50 dark:border-white/10 dark:bg-white/5 dark:text-white/50">
                <span className="sr-only">Snapshot metadata: </span><span>{value}</span>
              </div>
            ))}
            {snapshot.hasTranslations ? (
              <div className="inline-flex min-h-7 items-center rounded-full border border-blue-600/20 bg-blue-500/8 px-3 py-1 text-xs text-blue-800 dark:text-blue-300">
                <span className="sr-only">Computed tag: </span>
                <span>localized</span>
              </div>
            ) : null}
            <SnapshotTags
              snapshotId={snapshot.summary.id}
              initialTags={customTags}
              suggestions={tagSuggestions}
              editable={snapshot.isOwner}
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="text-left text-xs leading-5 text-black/40 dark:text-white/40">
              <p>Created <time dateTime={snapshot.summary.createdAt}>{dateFormatter.format(new Date(snapshot.summary.createdAt))}</time></p>
              <p>Updated <time dateTime={snapshot.summary.updatedAt}>{dateFormatter.format(new Date(snapshot.summary.updatedAt))}</time></p>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              <FavoriteButton
                target={{ type: "snapshot", snapshotId: snapshot.summary.id }}
                initialFavorite={isFavorite}
                label={snapshot.summary.name}
                compact
              />
              {snapshot.isOwner ? (
                <>
                <SnapshotCreateVersion
                  viewedSnapshotId={snapshot.summary.id}
                  latest={latestVersion}
                />
                <SnapshotRestore
                  snapshot={{
                    ...snapshot.summary,
                    availableRestoreGroups: snapshot.availableRestoreGroups,
                  }}
                  destinations={restoreDestinations}
                  stepNames={[
                    ...snapshot.categories.map((category) => `Restoring category ${category.name}`),
                    ...snapshot.products.map((product) => `Restoring product ${product.name}`),
                  ]}
                />
                <SnapshotSettingsInspector
                  snapshotId={snapshot.summary.id}
                  snapshotName={snapshot.summary.name}
                />
                <SnapshotVersionHistory
                  name={snapshot.summary.name}
                  currentSnapshotId={snapshot.summary.id}
                  versions={snapshot.versions}
                />
                <SnapshotVersionDiff
                  name={snapshot.summary.name}
                  currentSnapshotId={snapshot.summary.id}
                  versions={snapshot.versions}
                />
                <CatalogHistory
                  title={`${snapshot.summary.name} history`}
                  entries={history}
                />
                <SnapshotDelete
                  snapshotId={snapshot.summary.id}
                  snapshotName={snapshot.summary.name}
                  versionCount={snapshot.versions.length}
                />
                </>
              ) : (
                <>
                  <SnapshotRestore
                    snapshot={{
                      ...snapshot.summary,
                      availableRestoreGroups: snapshot.availableRestoreGroups,
                    }}
                    destinations={restoreDestinations}
                    matchSourceDestination={false}
                    stepNames={[
                      ...snapshot.categories.map((category) => `Restoring category ${category.name}`),
                      ...snapshot.products.map((product) => `Restoring product ${product.name}`),
                    ]}
                  />
                  <SnapshotSettingsInspector
                    snapshotId={snapshot.summary.id}
                    snapshotName={snapshot.summary.name}
                  />
                </>
              )}
            </div>
          </div>
        </header>

        <div className="mt-4 flex flex-wrap">
          <CatalogOperationProgress
            redirectToCreatedSnapshot={snapshot.isOwner}
            snapshotId={snapshot.summary.id}
            initialOperation={activeCapture ? {
              kind: "snapshot",
              operationId: activeCapture.id,
              environmentId: activeCapture.environmentId ?? undefined,
              channelId: activeCapture.channelId ?? undefined,
              snapshotId: snapshot.summary.id,
              originPath: activeCaptureOriginPath,
            } : undefined}
            redirectOnCancelTo="/snapshots"
          />
        </div>

        <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/7 p-4 text-xs leading-5 text-emerald-900 dark:text-emerald-200">
          {snapshot.isOwner ? "Restoration-ready manifest" : "Published read-only manifest"}: choose any saved environment and active
          channel to reconcile categories, products, variants, images, metadata,
          and channel/category assignments from this immutable version.
        </div>

        {snapshot.error ? (
          <div
            role="alert"
            className="mt-7 rounded-2xl border border-red-500/25 bg-red-500/8 p-5 text-sm text-red-800 dark:text-red-200"
          >
            {snapshot.error}
          </div>
        ) : (
          <div className="mt-7 grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-black/10 bg-white/60 p-4 backdrop-blur lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto dark:border-white/10 dark:bg-white/4">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-black/8 pb-3 dark:border-white/8">
                <h2 className="text-sm font-semibold tracking-tight">
                  Categories
                </h2>
                <span className="text-xs text-black/35 dark:text-white/35">
                  Captured tree
                </span>
              </div>

              {snapshot.categories.length === 0 ? (
                <p className="text-xs leading-5 text-black/40 dark:text-white/40">
                  This snapshot does not contain a category tree.
                </p>
              ) : (
                <CatalogCategoryTree
                  categories={snapshot.categories}
                  basePath={basePath}
                  selectedCategoryId={selectedCategory?.id ?? null}
                  locale={snapshot.activeLocale ?? undefined}
                />
              )}
            </aside>

            <section aria-labelledby="snapshot-products-heading" className="min-w-0">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2
                  id="snapshot-products-heading"
                  className="text-lg font-semibold tracking-tight"
                >
                  Products
                  {selectedCategory ? (
                    <span className="font-normal text-black/40 dark:text-white/40">
                      {" "}in {selectedCategory.name}
                    </span>
                  ) : null}
                </h2>
                <div className="flex shrink-0 items-center gap-2 text-xs text-black/40 dark:text-white/40">
                  <span>{products.length} captured · {snapshot.currency}</span>
                  {snapshot.locales.length > 1 && snapshot.activeLocale ? (
                    <CatalogLocaleSelector
                      locales={snapshot.locales}
                      activeLocale={snapshot.activeLocale}
                    />
                  ) : null}
                </div>
              </div>

              {products.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-black/15 px-6 py-14 text-center dark:border-white/15">
                  <p className="font-medium">No captured products were found.</p>
                  <p className="mt-1 text-sm text-black/45 dark:text-white/45">
                    {selectedCategory
                      ? `No captured products are assigned to ${selectedCategory.name} or its subcategories.`
                      : "This snapshot does not contain products."}
                  </p>
                </div>
              ) : (
                <ProductInspectorProvider
                  endpoint={`/api/snapshots/${snapshot.summary.id}/products`}
                  source="snapshot"
                >
                  <CollectionBrowser
                  collectionId="snapshot-products"
                  ariaLabel={`${snapshot.summary.name} products`}
                  searchPlaceholder="Search captured products…"
                  cardsClassName="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
                  tableClassName="table-fixed"
                  columns={[
                    { key: "name", label: "Product", className: "w-[30%]" },
                    { key: "description", label: "Description", className: "w-[48%]" },
                    { key: "categories", label: "Categories", className: "w-[10%]" },
                    { key: "price", label: "Price", align: "right", className: "w-[12%]" },
                  ]}
                  items={products.map((product) => ({
                    id: String(product.id),
                    searchText: `${product.id} ${product.name} ${product.description} ${product.price ?? ""}`,
                    card: (
                      <ProductInspectorTrigger
                        product={product}
                        trigger={<CatalogProductCard product={product} priceFormatter={priceFormatter} />}
                        triggerClassName="block h-full min-w-0 cursor-pointer rounded-2xl text-left focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-emerald-600"
                        cardTrigger
                      />
                    ),
                    cells: [
                      <ProductInspectorTrigger
                        key="name"
                        product={product}
                        trigger={<span className="line-clamp-2 break-words">{product.name}</span>}
                        triggerClassName="w-full rounded-sm text-left font-semibold underline-offset-4 hover:text-emerald-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:hover:text-emerald-300"
                      />,
                      <span key="description" className="line-clamp-2 break-words text-black/50 dark:text-white/50">{product.description || "No description available."}</span>,
                      product.categoryIds.length,
                      <span key="price" className="whitespace-nowrap font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{product.price === null ? "—" : priceFormatter.format(product.price)}</span>,
                    ],
                  }))}
                  />
                </ProductInspectorProvider>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
