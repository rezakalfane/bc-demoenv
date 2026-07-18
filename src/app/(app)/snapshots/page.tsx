import Link from "next/link";
import { requireAppUser } from "@/lib/auth";
import { getActiveSnapshotOperations, getCatalogSnapshotSeries } from "@/lib/db";
import { CatalogOperationProgress } from "@/components/catalog-operation-progress";
import { PublishedIcon } from "@/components/action-icons";

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

export default async function SnapshotsPage() {
  const user = await requireAppUser();
  const [snapshots, activeOperations] = await Promise.all([
    getCatalogSnapshotSeries(user.id),
    getActiveSnapshotOperations(user.id),
  ]);
  const pendingSnapshots = activeOperations.map((operation) => {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(operation.payloadJson) as Record<string, unknown>; } catch {}
    return {
      operation,
      name: String(payload.name || "Snapshot capture"),
      environmentId: Number(payload.environmentId || operation.environmentId),
      channelId: Number(payload.channelId || operation.channelId),
    };
  });

  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
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
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {pendingSnapshots.map(({ operation, name, environmentId, channelId }) => (
              <article key={`pending-${operation.id}`} className="flex min-h-72 flex-col rounded-3xl border border-emerald-500/25 bg-emerald-500/7 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.05)] sm:p-6">
                <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">Capture in progress</p><h2 className="mt-2 break-words text-lg font-semibold tracking-tight">{name}</h2><p className="mt-1 text-xs text-black/40 dark:text-white/40">Environment {environmentId} · Channel {channelId}</p></div>
                <div className="mt-auto pt-6">
                  <CatalogOperationProgress initialOperation={{ kind: "snapshot", operationId: operation.id, environmentId, channelId }} />
                </div>
              </article>
            ))}
            {snapshots.map((snapshot) => (
              <article
                key={snapshot.id}
                className={`flex min-h-72 flex-col rounded-3xl border bg-white/70 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.05)] backdrop-blur sm:p-6 dark:bg-white/4 ${snapshot.publishedSnapshotId ? "border-blue-500/45 dark:border-blue-400/40" : "border-black/10 dark:border-white/10"}`}
              >
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold tracking-tight">
                    <Link
                      href={`/snapshots/${snapshot.id}`}
                      className="block rounded-sm transition hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:hover:text-emerald-300"
                    >
                      <span className="inline-flex items-center gap-2">
                        {snapshot.name}
                        {snapshot.publishedSnapshotId ? (
                          <><PublishedIcon className="text-blue-600 dark:text-blue-300" /><span className="sr-only">Published snapshot</span></>
                        ) : null}
                      </span>
                    </Link>
                  </h2>
                  <p className="mt-1 truncate text-xs text-black/40 dark:text-white/40">
                    {snapshot.sourceEnvironmentName} ·{" "}
                    {snapshot.sourceChannelName}
                  </p>
                  {!snapshot.isOwner ? (
                    <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700 dark:text-blue-300">
                      Published catalog · read only
                    </p>
                  ) : null}
                </div>

                <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Categories", snapshot.categoryCount],
                    ["Products", snapshot.productCount],
                    ["Variants", snapshot.variantCount],
                    ["Images", snapshot.imageCount],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-black/8 bg-black/2.5 p-3.5 dark:border-white/8 dark:bg-white/3"
                    >
                      <dt className="text-xs text-black/40 dark:text-white/40">
                        {label}
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-auto flex items-end justify-between gap-4 pt-5">
                  <div className="min-w-0 text-xs leading-5 text-black/40 dark:text-white/40">
                    <p>
                      Latest capture{" "}
                      <time dateTime={snapshot.createdAt}>
                        {dateFormatter.format(new Date(snapshot.createdAt))}
                      </time>
                    </p>
                    <p>
                      {snapshot.metafieldCount} metafields ·{" "}
                      {formatBytes(snapshot.payloadBytes)}
                    </p>
                    <p>
                      {snapshot.versionCount}{" "}
                      {snapshot.versionCount === 1 ? "version" : "versions"} ·{" "}
                      Manifest format v{snapshot.formatVersion}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${snapshot.publishedSnapshotId ? "bg-blue-500/12 text-blue-700 dark:text-blue-300" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"}`}>
                    {snapshot.publishedSnapshotId ? `Published v${snapshot.publishedVersion}` : `Latest v${snapshot.snapshotVersion}`}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
