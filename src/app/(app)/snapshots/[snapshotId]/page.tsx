import Link from "next/link";
import { notFound } from "next/navigation";
import { CatalogCategoryTree } from "@/components/catalog-category-tree";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { SnapshotRestore } from "@/components/snapshot-restore";
import { SnapshotVersionHistory } from "@/components/snapshot-version-history";
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
import { getActiveSnapshotOperations } from "@/lib/db";
import { PublishedIcon } from "@/components/action-icons";

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
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const [{ snapshotId }, query] = await Promise.all([params, searchParams]);
  const parsedSnapshotId = Number(snapshotId);
  const requestedCategory = Array.isArray(query.category)
    ? query.category[0]
    : query.category;
  const parsedCategoryId = Number(requestedCategory);

  if (!Number.isSafeInteger(parsedSnapshotId) || parsedSnapshotId < 1) {
    notFound();
  }

  const [snapshot, restoreDestinations] = await Promise.all([
    getCatalogSnapshotView(parsedSnapshotId),
    getCatalogRestoreDestinations(),
  ]);

  if (!snapshot) {
    notFound();
  }

  const history = snapshot.isOwner
    ? await getSnapshotCatalogHistory(parsedSnapshotId)
    : [];

  const user = await requireAppUser();
  const activeCapture = snapshot.isOwner ? (await getActiveSnapshotOperations(user.id)).find((operation) => {
    try {
      const payload = JSON.parse(operation.payloadJson) as { name?: unknown };
      return String(payload.name ?? "").localeCompare(snapshot.summary.name, undefined, { sensitivity: "base" }) === 0;
    } catch {
      return false;
    }
  }) : undefined;
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
  const priceFormatter = new Intl.NumberFormat("en", {
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
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                <span className="inline-flex items-center gap-3">
                  {snapshot.summary.name}
                  {publishedVersion ? (
                    <><PublishedIcon className="text-blue-600 dark:text-blue-300" /><span className="sr-only">Published snapshot</span></>
                  ) : null}
                  <CatalogActivityBadge snapshotId={snapshot.summary.id} />
                </span>
              </h1>
              <p className="mt-3 text-sm text-black/45 dark:text-white/45">
                {snapshot.summary.sourceEnvironmentName} ·{" "}
                {snapshot.summary.sourceChannelName}
              </p>
          </div>

          <dl className="mt-5 flex flex-wrap gap-2">
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
                <dt className="sr-only">Snapshot metadata</dt><dd>{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="text-left text-xs leading-5 text-black/40 dark:text-white/40">
              <p>Created <time dateTime={snapshot.summary.createdAt}>{dateFormatter.format(new Date(snapshot.summary.createdAt))}</time></p>
              <p>Updated <time dateTime={snapshot.summary.updatedAt}>{dateFormatter.format(new Date(snapshot.summary.updatedAt))}</time></p>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {snapshot.isOwner ? (
                <>
                <SnapshotCreateVersion
                  viewedSnapshotId={snapshot.summary.id}
                  latest={latestVersion}
                />
                <SnapshotRestore
                  snapshot={snapshot.summary}
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
                    snapshot={snapshot.summary}
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
                <p className="text-xs text-black/40 dark:text-white/40">
                  {products.length} captured · {snapshot.currency}
                </p>
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
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                  {products.map((product) => (
                    <CatalogProductCard
                      key={product.id}
                      product={product}
                      priceFormatter={priceFormatter}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
