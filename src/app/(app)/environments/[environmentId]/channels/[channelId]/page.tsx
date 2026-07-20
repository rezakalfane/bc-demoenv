import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogCategoryTree } from "@/components/catalog-category-tree";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { ClearCatalog } from "@/components/clear-catalog";
import { CatalogActivityBadge, CatalogOperationProgress } from "@/components/catalog-operation-progress";
import { ChannelCatalogLiveState } from "@/components/channel-catalog-live-state";
import { SnapshotForm } from "@/components/snapshot-form";
import { SnapshotRestore } from "@/components/snapshot-restore";
import { CatalogHistory } from "@/components/catalog-history";
import { FavoriteButton } from "@/components/favorite-button";
import { CollectionBrowser } from "@/components/collection-browser";
import { CatalogLocaleSelector } from "@/components/catalog-locale-selector";
import { requireAppUser } from "@/lib/auth";
import { getChannelCatalog } from "@/lib/bigcommerce-catalog";
import {
  filterProductsByCategory,
  findCatalogCategory,
} from "@/lib/catalog-filter";
import {
  getCatalogSnapshots,
  getChannelFavoriteKey,
  getFavoriteResourceKeys,
  getLatestCatalogSnapshotSeries,
  getSnapshotFavoriteKey,
} from "@/lib/db";
import { getCatalogRestoreDestinations } from "@/lib/catalog-restore";
import { getChannelCatalogHistory } from "@/lib/catalog-history";

export const dynamic = "force-dynamic";

function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-amber-500/25 bg-amber-500/8 p-5 text-sm text-amber-800 dark:text-amber-200"
    >
      {message}
    </div>
  );
}

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ environmentId: string; channelId: string }>;
  searchParams: Promise<{
    category?: string | string[];
    locale?: string | string[];
  }>;
}) {
  const [{ environmentId, channelId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const parsedEnvironmentId = Number(environmentId);
  const parsedChannelId = Number(channelId);
  const requestedCategory = Array.isArray(query.category)
    ? query.category[0]
    : query.category;
  const parsedCategoryId = Number(requestedCategory);
  const requestedLocale = Array.isArray(query.locale)
    ? query.locale[0]
    : query.locale;

  if (
    !Number.isSafeInteger(parsedEnvironmentId) ||
    parsedEnvironmentId < 1 ||
    !Number.isSafeInteger(parsedChannelId) ||
    parsedChannelId < 1
  ) {
    notFound();
  }

  const user = await requireAppUser();
  const [catalog, snapshotSuggestions, allSnapshots, restoreDestinations, history, channelFavoriteKeys, snapshotFavoriteKeys] = await Promise.all([
    getChannelCatalog(parsedEnvironmentId, parsedChannelId, requestedLocale),
    getLatestCatalogSnapshotSeries(user.id),
    getCatalogSnapshots(user.id),
    getCatalogRestoreDestinations(),
    getChannelCatalogHistory(parsedEnvironmentId, parsedChannelId),
    getFavoriteResourceKeys(user.id, "channel"),
    getFavoriteResourceKeys(user.id, "snapshot"),
  ]);

  if (!catalog) {
    notFound();
  }

  const priceFormatter = new Intl.NumberFormat(catalog.activeLocale ?? "en", {
    style: "currency",
    currency: catalog.currency,
  });
  const channelTitle = catalog.channel?.name ?? "Channel catalog";
  const channelMetadata = [catalog.channel?.type, catalog.channel?.platform]
    .filter(Boolean)
    .join(" · ");
  const selectedCategory = Number.isSafeInteger(parsedCategoryId)
    ? findCatalogCategory(catalog.categories, parsedCategoryId)
    : null;
  const products = filterProductsByCategory(
    catalog.products,
    selectedCategory,
  );
  const basePath = `/environments/${catalog.environment.id}/channels/${parsedChannelId}`;
  const isFavorite = channelFavoriteKeys.has(
    getChannelFavoriteKey(catalog.environment.id, parsedChannelId),
  );
  const restoreSnapshotOptions = allSnapshots.map((snapshot) => ({
    ...snapshot,
    isFavorite: snapshotFavoriteKeys.has(
      getSnapshotFavoriteKey(snapshot.ownerUserId, snapshot.name),
    ),
  }));

  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-10">
      <div className="mx-auto w-full max-w-[1320px]">
        <Link
          href={`/environments/${catalog.environment.id}`}
          className="inline-flex rounded-sm text-sm font-medium text-black/45 transition hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:text-white/45 dark:hover:text-emerald-300"
        >
          ← {catalog.environment.name}
        </Link>

        <header className="mt-7 border-b border-black/10 pb-7 dark:border-white/10">
          <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Channel catalog
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                <span className="inline-flex items-center gap-3">{channelTitle}<CatalogActivityBadge environmentId={catalog.environment.id} channelId={catalog.channel?.id} /></span>
              </h1>
              {channelMetadata ? (
                <p className="mt-3 text-xs capitalize text-black/40 dark:text-white/40">
                  {channelMetadata}
                </p>
              ) : null}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
              <span className="w-fit shrink-0 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-black/50 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-white/50">
                {products.length}{" "}
                {products.length === 1 ? "product" : "products"}
              </span>
          </div>
          {!catalog.error && catalog.channel ? <div className="mt-4 flex flex-wrap justify-end gap-1.5">
                <FavoriteButton
                  target={{
                    type: "channel",
                    environmentId: catalog.environment.id,
                    channelId: catalog.channel.id,
                  }}
                  initialFavorite={isFavorite}
                  label={catalog.channel.name}
                  compact
                />
                <SnapshotForm
                  environmentId={catalog.environment.id}
                  channelId={catalog.channel.id}
                  channelName={catalog.channel.name}
                  suggestions={snapshotSuggestions.map((snapshot) => ({
                    name: snapshot.name,
                    snapshotVersion: snapshot.snapshotVersion,
                    sourceChannelName: snapshot.sourceChannelName,
                  }))}
                />
                {allSnapshots.length > 0 ? <SnapshotRestore
                  snapshot={restoreSnapshotOptions[0]}
                  snapshotOptions={restoreSnapshotOptions}
                  destinations={restoreDestinations}
                  initialDestinationEnvironmentId={catalog.environment.id}
                  initialDestinationChannelId={catalog.channel.id}
                  stepNames={[
                    ...catalog.categories.map((category) => `Restoring category ${category.name}`),
                    ...catalog.products.map((product) => `Restoring product ${product.name}`),
                  ]}
                /> : null}
                <ClearCatalog
                  environmentId={catalog.environment.id}
                  channelId={catalog.channel.id}
                  channelName={catalog.channel.name}
                  stepNames={[
                    ...catalog.categories.map((category) => `Removing category ${category.name}`),
                    ...catalog.products.map((product) => `Unassigning product ${product.name}`),
                  ]}
                />
                <CatalogHistory title={`${channelTitle} history`} entries={history} />
          </div> : null}
        </header>

        <div className="mt-4 flex flex-wrap">
          <ChannelCatalogLiveState environmentId={catalog.environment.id} channelId={parsedChannelId} />
          <CatalogOperationProgress
            redirectToCreatedSnapshot
            environmentId={catalog.environment.id}
            channelId={catalog.channel?.id ?? parsedChannelId}
          />
        </div>

        {catalog.error ? (
          <div className="mt-7">
            <ErrorNotice message={catalog.error} />
            <Link
              href="/settings"
              className="mt-4 inline-flex text-sm font-semibold text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-200"
            >
              Review this environment in Settings →
            </Link>
          </div>
        ) : (
          <div className="mt-7 grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="channel-live-categories rounded-2xl border border-black/10 bg-white/60 p-4 backdrop-blur lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto dark:border-white/10 dark:bg-white/4">
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-black/8 pb-3 dark:border-white/8">
                <h2 className="text-sm font-semibold tracking-tight">
                  Categories
                </h2>
                <span className="text-xs text-black/35 dark:text-white/35">
                  Tree view
                </span>
              </div>

              {catalog.categoriesError ? (
                <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                  {catalog.categoriesError}
                </p>
              ) : catalog.categories.length === 0 ? (
                <p className="text-xs leading-5 text-black/40 dark:text-white/40">
                  No category tree is assigned to this channel.
                </p>
              ) : (
                <CatalogCategoryTree
                  categories={catalog.categories}
                  basePath={basePath}
                  selectedCategoryId={selectedCategory?.id ?? null}
                  locale={catalog.activeLocale ?? undefined}
                />
              )}
            </aside>

            <section aria-labelledby="products-heading" className="min-w-0">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2
                  id="products-heading"
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
                  <span>{catalog.currency} prices</span>
                  {catalog.locales.length > 1 && catalog.activeLocale ? (
                    <CatalogLocaleSelector
                      locales={catalog.locales}
                      activeLocale={catalog.activeLocale}
                    />
                  ) : null}
                </div>
              </div>

              {catalog.productsError ? (
                <ErrorNotice message={catalog.productsError} />
              ) : products.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-black/15 px-6 py-14 text-center dark:border-white/15">
                  <p className="font-medium">No products were found.</p>
                  <p className="mt-1 text-sm text-black/45 dark:text-white/45">
                    {selectedCategory
                      ? `No products are assigned to ${selectedCategory.name} or its subcategories.`
                      : "This channel does not currently return any catalog products."}
                  </p>
                </div>
              ) : (
                <CollectionBrowser
                  collectionId="channel-products"
                  ariaLabel={`${channelTitle} products`}
                  searchPlaceholder="Search products…"
                  cardsClassName="channel-live-products grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"
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
                    card: <CatalogProductCard product={product} priceFormatter={priceFormatter} />,
                    cells: [
                      <span key="name" className="line-clamp-2 break-words font-semibold">{product.name}</span>,
                      <span key="description" className="line-clamp-2 break-words text-black/50 dark:text-white/50">{product.description || "No description available."}</span>,
                      product.categoryIds.length,
                      <span key="price" className="whitespace-nowrap font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{product.price === null ? "—" : priceFormatter.format(product.price)}</span>,
                    ],
                  }))}
                />
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
