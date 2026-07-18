import Link from "next/link";
import { Suspense } from "react";
import {
  getEnvironmentDashboards,
  type EnvironmentDashboard,
} from "@/lib/bigcommerce";
import { CatalogActivityBadge } from "@/components/catalog-operation-progress";

export const dynamic = "force-dynamic";

const metricKeys = ["channels", "categories", "products", "variants"] as const;
const numberFormatter = new Intl.NumberFormat("en");
const statusStyles = {
  connected: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  partial: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  unavailable: "bg-red-500/10 text-red-700 dark:text-red-300",
};
const statusLabels = {
  connected: "Connected",
  partial: "Partial data",
  unavailable: "Unavailable",
};

function EnvironmentCard({ environment }: { environment: EnvironmentDashboard }) {
  const firstError = metricKeys
    .map((key) => environment.metrics[key].error)
    .find((error) => error !== null);

  return (
    <article className="flex min-h-72 flex-col rounded-3xl border border-black/10 bg-white/70 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.05)] backdrop-blur sm:p-6 dark:border-white/10 dark:bg-white/4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            <Link
              href={`/environments/${environment.id}`}
              className="rounded-sm transition hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:hover:text-emerald-300"
            >
              <span className="inline-flex items-center gap-3">{environment.name}<CatalogActivityBadge environmentId={environment.id} /></span>
            </Link>
          </h2>
          <p className="mt-1 truncate font-mono text-xs text-black/40 dark:text-white/40">
            {environment.storeHash}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyles[environment.status]}`}
        >
          {statusLabels[environment.status]}
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3">
        {metricKeys.map((key) => {
          const metric = environment.metrics[key];

          return (
            <div
              key={key}
              className="rounded-2xl border border-black/8 bg-black/2.5 p-4 dark:border-white/8 dark:bg-white/3"
            >
              <dt className="text-xs font-medium text-black/45 dark:text-white/45">
                {metric.label}
              </dt>
              <dd className="mt-2">
                {metric.value === null ? (
                  <span
                    className="text-sm font-medium text-black/35 dark:text-white/35"
                    title={metric.error ?? undefined}
                  >
                    Not available
                  </span>
                ) : (
                  <span className="text-2xl font-semibold tracking-[-0.04em] tabular-nums">
                    {numberFormatter.format(metric.value)}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {firstError ? (
        <p className="mt-4 text-xs leading-5 text-amber-700 dark:text-amber-300">
          {firstError}
        </p>
      ) : null}

      <div className="mt-auto pt-5">
        <Link
          href="/settings"
          className="text-xs font-medium text-black/45 transition hover:text-emerald-700 dark:text-white/45 dark:hover:text-emerald-300"
        >
          Manage environment →
        </Link>
      </div>
    </article>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="h-72 animate-pulse rounded-3xl border border-black/8 bg-black/3 dark:border-white/8 dark:bg-white/3"
        />
      ))}
    </div>
  );
}

async function EnvironmentGrid() {
  const environments = await getEnvironmentDashboards();

  if (environments.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-black/15 px-6 py-14 text-center dark:border-white/15">
        <p className="font-medium">No BigCommerce environments yet.</p>
        <p className="mt-1 text-sm text-black/45 dark:text-white/45">
          Add a store connection to start seeing catalog metrics.
        </p>
        <Link
          href="/settings"
          className="mt-5 inline-flex rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-emerald-300"
        >
          Add an environment
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {environments.map((environment) => (
        <EnvironmentCard key={environment.id} environment={environment} />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-8 flex flex-col gap-5 border-b border-black/10 pb-7 dark:border-white/10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              Dashboard
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              Store environments
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-black/55 dark:text-white/55">
              A live overview of the channels and catalog resources available in
              each saved BigCommerce environment.
            </p>
          </div>
          <span className="w-fit rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-black/50 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-white/50">
            Live from BigCommerce
          </span>
        </header>

        <Suspense fallback={<DashboardSkeleton />}>
          <EnvironmentGrid />
        </Suspense>
      </div>
    </div>
  );
}
