"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  environmentMetricKeys,
  type EnvironmentDashboard,
  type MetricKey,
} from "@/lib/dashboard-types";
import { CatalogActivityBadge } from "@/components/catalog-operation-progress";
import { FavoriteButton } from "@/components/favorite-button";
import { ClientCollectionBrowser } from "@/components/client-collection-browser";

const metricKeys: readonly MetricKey[] = environmentMetricKeys;
const numberFormatter = new Intl.NumberFormat("en");
const statusStyles = {
  connected: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  partial: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  unavailable: "bg-red-500/10 text-red-700 dark:text-red-300",
  loading: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
};
const statusLabels = {
  connected: "Connected",
  partial: "Partial data",
  unavailable: "Unavailable",
  loading: "Loading live data",
};

function EnvironmentStatus({ environment }: { environment: EnvironmentDashboard }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyles[environment.status]}`}>
      {statusLabels[environment.status]}
    </span>
  );
}

function EnvironmentMetric({ environment, metricKey }: { environment: EnvironmentDashboard; metricKey: MetricKey }) {
  const value = environment.metrics[metricKey].value;
  return value === null ? "—" : numberFormatter.format(value);
}

function EnvironmentCard({ environment }: { environment: EnvironmentDashboard }) {
  const firstError = metricKeys
    .map((key) => environment.metrics[key].error)
    .find((error) => error !== null);

  return (
    <article className="flex min-h-72 flex-col rounded-3xl border border-black/10 bg-white/70 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.05)] backdrop-blur sm:p-6 dark:border-white/10 dark:bg-white/4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">
            <Link href={`/environments/${environment.id}`} className="rounded-sm transition hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 dark:hover:text-emerald-300">
              <span className="inline-flex items-center gap-3">{environment.name}<CatalogActivityBadge environmentId={environment.id} /></span>
            </Link>
          </h2>
          <p className="mt-1 truncate font-mono text-xs text-black/40 dark:text-white/40">{environment.storeHash}</p>
        </div>
        <FavoriteButton target={{ type: "environment", environmentId: environment.id }} initialFavorite={environment.isFavorite} label={environment.name} />
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3">
        {metricKeys.map((key) => {
          const metric = environment.metrics[key];
          return (
            <div key={key} className="rounded-2xl border border-black/8 bg-black/2.5 p-4 dark:border-white/8 dark:bg-white/3">
              <dt className="text-xs font-medium text-black/45 dark:text-white/45">{metric.label}</dt>
              <dd className="mt-2">
                {metric.value === null ? (
                  <span className="text-sm font-medium text-black/35 dark:text-white/35" title={metric.error ?? undefined}>
                    {environment.status === "loading" ? "Refreshing…" : "Not available"}
                  </span>
                ) : (
                  <span className="text-2xl font-semibold tracking-[-0.04em] tabular-nums">{numberFormatter.format(metric.value)}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {firstError ? <p className="mt-4 text-xs leading-5 text-amber-700 dark:text-amber-300">{firstError}</p> : null}

      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <Link href="/settings" className="text-xs font-medium text-black/45 transition hover:text-emerald-700 dark:text-white/45 dark:hover:text-emerald-300">Manage environment →</Link>
        <EnvironmentStatus environment={environment} />
      </div>
    </article>
  );
}

function latestRefresh(environments: EnvironmentDashboard[]) {
  const dates = environments
    .map(({ refreshedAt }) => refreshedAt ? new Date(refreshedAt).getTime() : Number.NaN)
    .filter(Number.isFinite);
  if (dates.length === 0) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(Math.max(...dates)));
}

export function DashboardEnvironments({
  initialEnvironments,
  initialView,
}: {
  initialEnvironments: EnvironmentDashboard[];
  initialView: "cards" | "table";
}) {
  const [environments, setEnvironments] = useState(initialEnvironments);
  const [refreshState, setRefreshState] = useState<"refreshing" | "live" | "error">("refreshing");
  const requestRef = useRef<Promise<EnvironmentDashboard[]> | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      requestRef.current ??= fetch("/api/dashboard/environments", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Dashboard refresh failed.");
          const payload = await response.json() as { environments?: EnvironmentDashboard[] };
          if (!Array.isArray(payload.environments)) throw new Error("Dashboard returned invalid data.");
          return payload.environments;
        });

      void requestRef.current.then(
        (nextEnvironments) => {
          if (!active) return;
          setEnvironments(nextEnvironments);
          setRefreshState("live");
        },
        () => {
          if (!active) return;
          setRefreshState("error");
        },
      );
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const refreshedAt = latestRefresh(environments);

  return (
    <>
      <header className="mb-8 flex flex-col gap-5 border-b border-black/10 pb-7 dark:border-white/10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Dashboard</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Store environments</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-black/55 dark:text-white/55">
            Last-known catalog metrics load immediately, then refresh from BigCommerce in the background.
          </p>
        </div>
        <div className="flex w-fit items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-black/50 shadow-sm backdrop-blur dark:border-white/10 dark:bg-white/5 dark:text-white/50">
          <span className={`size-2 rounded-full ${refreshState === "refreshing" ? "animate-pulse bg-sky-500" : refreshState === "live" ? "bg-emerald-500" : "bg-amber-500"}`} />
          {refreshState === "refreshing" ? "Refreshing from BigCommerce" : refreshState === "live" ? `Live${refreshedAt ? ` · ${refreshedAt}` : ""}` : "Using cached data"}
        </div>
      </header>

      {environments.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-black/15 px-6 py-14 text-center dark:border-white/15">
          <p className="font-medium">No BigCommerce environments yet.</p>
          <p className="mt-1 text-sm text-black/45 dark:text-white/45">Add a store connection to start seeing catalog metrics.</p>
          <Link href="/settings" className="mt-5 inline-flex rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-emerald-300">Add an environment</Link>
        </div>
      ) : (
        <ClientCollectionBrowser
          collectionId="dashboard-environments"
          ariaLabel="Store environments"
          searchPlaceholder="Search environments…"
          initialView={initialView}
          initialShowShared={true}
          columns={[
            { key: "name", label: "Environment", className: "max-w-56" },
            { key: "hash", label: "Store hash" },
            { key: "channels", label: "Channels", align: "right" },
            { key: "categories", label: "Categories", align: "right" },
            { key: "products", label: "Products", align: "right" },
            { key: "variants", label: "Variants", align: "right" },
            { key: "status", label: "Status" },
            { key: "favorite", label: "Favorite", align: "right" },
          ]}
          items={environments.map((environment) => ({
            id: String(environment.id),
            searchText: `${environment.name} ${environment.storeHash} ${statusLabels[environment.status]}`,
            card: <EnvironmentCard environment={environment} />,
            cells: [
              <Link key="name" href={`/environments/${environment.id}`} className="inline-flex max-w-full items-center gap-2 font-semibold text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-200"><span className="truncate">{environment.name}</span><CatalogActivityBadge environmentId={environment.id} /></Link>,
              <span key="hash" className="font-mono text-black/55 dark:text-white/55">{environment.storeHash}</span>,
              <EnvironmentMetric key="channels" environment={environment} metricKey="channels" />,
              <EnvironmentMetric key="categories" environment={environment} metricKey="categories" />,
              <EnvironmentMetric key="products" environment={environment} metricKey="products" />,
              <EnvironmentMetric key="variants" environment={environment} metricKey="variants" />,
              <EnvironmentStatus key="status" environment={environment} />,
              <div key="favorite" className="flex justify-end"><FavoriteButton target={{ type: "environment", environmentId: environment.id }} initialFavorite={environment.isFavorite} label={environment.name} /></div>,
            ],
          }))}
        />
      )}
    </>
  );
}
