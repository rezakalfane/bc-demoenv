import Link from "next/link";
import { clerkClient } from "@clerk/nextjs/server";
import { requireAppUser } from "@/lib/auth";
import {
  getActiveSnapshotOperations,
  getAccessibleCatalogSnapshotTagSeries,
  getCatalogSnapshotSeries,
  getCatalogSnapshotSeriesKey,
  getFavoriteResourceKeys,
  getSnapshotFavoriteKey,
  type CatalogSnapshotSeriesSummary,
} from "@/lib/db";
import { CatalogOperationProgress } from "@/components/catalog-operation-progress";
import { PublishedIcon } from "@/components/action-icons";
import { SnapshotLiveUpdates } from "@/components/snapshot-live-updates";
import { isSnapshotRealtimeConfigured } from "@/lib/snapshot-realtime";
import { FavoriteButton } from "@/components/favorite-button";
import { CollectionBrowser } from "@/components/collection-browser";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

type SnapshotListItem = CatalogSnapshotSeriesSummary & { isFavorite: boolean; tags: string[] };

function withComputedSnapshotTags(tags: string[], hasTranslations: boolean) {
  if (!hasTranslations) return tags;
  if (tags.some((tag) => tag.localeCompare("localized", "en-US", { sensitivity: "base" }) === 0)) {
    return tags;
  }
  return [...tags, "localized"].toSorted((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

function SnapshotSeriesCard({
  snapshot,
  publisherEmail,
}: {
  snapshot: SnapshotListItem;
  publisherEmail?: string;
}) {
  return (
    <article className={`flex min-h-72 flex-col rounded-3xl border bg-white/70 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.05)] backdrop-blur sm:p-6 dark:bg-white/4 ${snapshot.publishedSnapshotId ? "border-blue-500/45 dark:border-blue-400/40" : "border-black/10 dark:border-white/10"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold tracking-tight">
            <Link href={`/snapshots/${snapshot.id}`} className="block rounded-sm transition hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:hover:text-emerald-300">
              <span>
                {snapshot.name}
                {snapshot.publishedSnapshotId ? <><PublishedIcon className="ml-2 inline-block align-[-0.08em] text-blue-600 dark:text-blue-300" /><span className="sr-only"> Published snapshot</span></> : null}
              </span>
            </Link>
          </h2>
          <p className="mt-1 truncate text-xs text-black/40 dark:text-white/40">{snapshot.sourceEnvironmentName} · {snapshot.sourceChannelName}</p>
          {!snapshot.isOwner ? (
            <div className="mt-2 text-[11px] text-blue-700 dark:text-blue-300">
              <p className="font-semibold uppercase tracking-[0.14em]">Published catalog · read only</p>
              <p className="mt-1 normal-case tracking-normal text-black/45 dark:text-white/45">Published by {publisherEmail ?? "email unavailable"}</p>
            </div>
          ) : null}
          {snapshot.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {snapshot.tags.map((tag) => <span key={tag.toLocaleLowerCase("en-US")} className="rounded-full border border-emerald-600/20 bg-emerald-500/8 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:text-emerald-300">{tag}</span>)}
            </div>
          ) : null}
        </div>
        <FavoriteButton target={{ type: "snapshot", snapshotId: snapshot.id }} initialFavorite={snapshot.isFavorite} label={snapshot.name} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
        {[["Categories", snapshot.categoryCount], ["Products", snapshot.productCount], ["Variants", snapshot.variantCount], ["Images", snapshot.imageCount]].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-black/8 bg-black/2.5 p-3.5 dark:border-white/8 dark:bg-white/3">
            <dt className="text-xs text-black/40 dark:text-white/40">{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex items-end justify-between gap-4 pt-5">
        <div className="min-w-0 text-xs leading-5 text-black/40 dark:text-white/40">
          <p>Latest capture <time dateTime={snapshot.createdAt}>{dateFormatter.format(new Date(snapshot.createdAt))}</time></p>
          <p>{snapshot.metafieldCount} metafields · {formatBytes(snapshot.payloadBytes)}</p>
          <p>{snapshot.versionCount} {snapshot.versionCount === 1 ? "version" : "versions"} · Manifest format v{snapshot.formatVersion}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${snapshot.publishedSnapshotId ? "bg-blue-500/12 text-blue-700 dark:text-blue-300" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"}`}>
          {snapshot.publishedSnapshotId ? `Published v${snapshot.publishedVersion}` : `Latest v${snapshot.snapshotVersion}`}
        </span>
      </div>
    </article>
  );
}

export default async function SnapshotsPage() {
  const user = await requireAppUser();
  const [snapshots, activeOperations, favoriteKeys, tagsBySeries] = await Promise.all([
    getCatalogSnapshotSeries(user.id),
    getActiveSnapshotOperations(user.id),
    getFavoriteResourceKeys(user.id, "snapshot"),
    getAccessibleCatalogSnapshotTagSeries(user.id),
  ]);
  const pendingSnapshots = activeOperations.map((operation) => {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(operation.payloadJson) as Record<string, unknown>; } catch {}
    return {
      operation,
      name: String(payload.name || "Snapshot capture"),
      environmentId: Number(payload.environmentId || operation.environmentId),
      channelId: Number(payload.channelId || operation.channelId),
      originPath: typeof payload.originPath === "string" ? payload.originPath : undefined,
    };
  });
  const sortedSnapshots = snapshots
    .map((snapshot) => ({
      ...snapshot,
      isFavorite: favoriteKeys.has(
        getSnapshotFavoriteKey(snapshot.ownerUserId, snapshot.name),
      ),
      tags: withComputedSnapshotTags(
        tagsBySeries.get(
          getCatalogSnapshotSeriesKey(snapshot.ownerUserId, snapshot.name),
        ) ?? [],
        snapshot.hasTranslations,
      ),
    }))
    .toSorted((left, right) => {
    const favoriteOrder = Number(right.isFavorite) - Number(left.isFavorite);
    if (favoriteOrder !== 0) return favoriteOrder;
    const publicationOrder = Number(Boolean(right.publishedSnapshotId)) - Number(Boolean(left.publishedSnapshotId));
    if (publicationOrder !== 0) return publicationOrder;
    const nameOrder = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    return nameOrder !== 0 ? nameOrder : left.id - right.id;
    });
  const sharedOwnerIds = [...new Set(
    sortedSnapshots
      .filter((snapshot) => !snapshot.isOwner)
      .map((snapshot) => snapshot.ownerUserId),
  )];
  const publisherEmails = new Map<string, string>();
  const filterTags = [...new Set(sortedSnapshots.flatMap((snapshot) => snapshot.tags))]
    .toSorted((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  if (sharedOwnerIds.length > 0) {
    const client = await clerkClient();
    const publishers = await Promise.all(sharedOwnerIds.map(async (ownerUserId) => {
      try {
        const owner = await client.users.getUser(ownerUserId);
        return [ownerUserId, owner.primaryEmailAddress?.emailAddress ?? ""] as const;
      } catch {
        return [ownerUserId, ""] as const;
      }
    }));
    for (const [ownerUserId, email] of publishers) {
      if (email) publisherEmails.set(ownerUserId, email);
    }
  }

  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <SnapshotLiveUpdates enabled={isSnapshotRealtimeConfigured()} />
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-8 border-b border-black/10 pb-7 dark:border-white/10">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Snapshots
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            Catalog templates
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-black/55 dark:text-white/55">
            Browse restoration-ready catalog captures from your demo environments.
            Create a snapshot from any channel catalog page.
          </p>
        </header>

        {snapshots.length === 0 && pendingSnapshots.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-black/15 px-6 py-14 text-center dark:border-white/15">
            <p className="font-medium">No catalog snapshots yet.</p>
            <p className="mt-1 text-sm text-black/45 dark:text-white/45">
              Open an environment, choose a channel, and select Take snapshot.
            </p>
            <Link
              href="/"
              className="mt-5 inline-flex rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-emerald-300"
            >
              Open Dashboard
            </Link>
          </div>
        ) : (
          <CollectionBrowser
            collectionId="snapshot-series"
            ariaLabel="Catalog snapshots"
            searchPlaceholder="Search snapshots…"
            allowSharedToggle
            filterTags={filterTags}
            columns={[
              { key: "name", label: "Snapshot", className: "max-w-64" },
              { key: "source", label: "Source", className: "max-w-64" },
              { key: "access", label: "Access" },
              { key: "catalog", label: "Catalog" },
              { key: "tags", label: "Tags" },
              { key: "version", label: "Version" },
              { key: "captured", label: "Latest capture" },
              { key: "favorite", label: "Favorite", align: "right" },
            ]}
            items={[
              ...pendingSnapshots.map(({ operation, name, environmentId, channelId, originPath }) => ({
                id: `pending-${operation.id}`,
                searchText: `${name} ${environmentId} ${channelId} capture in progress`,
                tags: [],
                card: <article className="flex min-h-72 flex-col rounded-3xl border border-emerald-500/25 bg-emerald-500/7 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.05)] sm:p-6"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Capture in progress</p><h2 className="mt-2 break-words text-lg font-semibold tracking-tight">{name}</h2><p className="mt-1 text-xs text-black/40 dark:text-white/40">Environment {environmentId} · Channel {channelId}</p></div><div className="mt-auto pt-6"><CatalogOperationProgress initialOperation={{ kind: "snapshot", operationId: operation.id, environmentId, channelId, originPath }} /></div></article>,
                cells: [
                  <span key="name" className="font-semibold">{name}</span>,
                  <span key="source">Environment {environmentId} · Channel {channelId}</span>,
                  <span key="access" className="rounded-full bg-amber-500/12 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">Capturing</span>,
                  "—",
                  "—",
                  "Pending",
                  <time key="captured" dateTime={operation.createdAt}>{dateFormatter.format(new Date(operation.createdAt))}</time>,
                  "—",
                ],
              })),
              ...sortedSnapshots.map((snapshot) => ({
                id: String(snapshot.id),
                searchText: `${snapshot.name} ${snapshot.sourceEnvironmentName} ${snapshot.sourceChannelName} ${snapshot.isOwner ? "owned" : "shared"} version ${snapshot.snapshotVersion} ${snapshot.tags.join(" ")}`,
                tags: snapshot.tags,
                isShared: !snapshot.isOwner,
                card: <SnapshotSeriesCard snapshot={snapshot} publisherEmail={publisherEmails.get(snapshot.ownerUserId)} />,
                cells: [
                  <Link key="name" href={`/snapshots/${snapshot.id}`} className="font-semibold text-emerald-700 hover:text-emerald-900 dark:text-emerald-300">{snapshot.name}{snapshot.publishedSnapshotId ? <PublishedIcon className="ml-1.5 inline-block align-[-0.08em] text-blue-600 dark:text-blue-300" /> : null}</Link>,
                  <span key="source" className="block truncate">{snapshot.sourceEnvironmentName} · {snapshot.sourceChannelName}</span>,
                  <span key="access" className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${snapshot.isOwner ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-blue-500/12 text-blue-700 dark:text-blue-300"}`}>{snapshot.isOwner ? "Owned" : "Shared"}</span>,
                  `${snapshot.categoryCount} cat. · ${snapshot.productCount} prod. · ${snapshot.variantCount} var.`,
                  snapshot.tags.length > 0 ? <div key="tags" className="flex max-w-48 flex-wrap gap-1">{snapshot.tags.map((tag) => <span key={tag.toLocaleLowerCase("en-US")} className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-800 dark:text-emerald-300">{tag}</span>)}</div> : "—",
                  snapshot.publishedSnapshotId ? `Published v${snapshot.publishedVersion}` : `Latest v${snapshot.snapshotVersion}`,
                  <time key="captured" dateTime={snapshot.createdAt} className="whitespace-nowrap">{dateFormatter.format(new Date(snapshot.createdAt))}</time>,
                  <div key="favorite" className="flex justify-end"><FavoriteButton target={{ type: "snapshot", snapshotId: snapshot.id }} initialFavorite={snapshot.isFavorite} label={snapshot.name} /></div>,
                ],
              })),
            ]}
          />
        )}
      </div>
    </div>
  );
}
