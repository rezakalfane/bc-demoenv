"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppI18n } from "@/components/app-i18n-provider";
import type {
  CatalogOperationListItem,
  OperationKind,
  OperationStatus,
} from "@/lib/catalog-operations-list";

type SortKey =
  | "id"
  | "kind"
  | "status"
  | "target"
  | "snapshot"
  | "progress"
  | "updatedAt"
  | "duration";

type SortState = { key: SortKey; direction: "asc" | "desc" };
type StatusFilter = "all" | "active" | OperationStatus;
type AttentionFilter = "all" | "attention" | "clean";
type DateFilter = "all" | "today" | "7d" | "30d";

const dateTimeFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});
const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const timeFormatter = new Intl.DateTimeFormat("en", { timeStyle: "short" });
const numberFormatter = new Intl.NumberFormat("en");
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function parseTimestamp(value: string | null | undefined) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDateTime(value: string | null | undefined) {
  const timestamp = parseTimestamp(value);
  return timestamp === null ? "Date unavailable" : dateTimeFormatter.format(timestamp);
}

const statusStyles: Record<OperationStatus, string> = {
  queued: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  running: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  completed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/12 text-red-700 dark:text-red-300",
  cancelled: "bg-neutral-500/12 text-neutral-600 dark:text-neutral-300",
};

const kindStyles: Record<OperationKind, string> = {
  snapshot: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  restore: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  refresh: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-300",
  clear: "bg-red-500/12 text-red-700 dark:text-red-300",
  database_sync: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  snapshot_renamed: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
  version_published: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
  version_unpublished: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  version_deleted: "bg-red-500/12 text-red-700 dark:text-red-300",
  environment_added: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  environment_deleted: "bg-red-500/12 text-red-700 dark:text-red-300",
  snapshot_deleted: "bg-red-500/12 text-red-700 dark:text-red-300",
};

const kindLabels: Record<OperationKind, string> = {
  snapshot: "Snapshot",
  restore: "Restore",
  refresh: "Clear & Restore",
  clear: "Catalog clear",
  database_sync: "Database sync",
  snapshot_renamed: "Snapshot renamed",
  version_published: "Version published",
  version_unpublished: "Version unpublished",
  version_deleted: "Version deleted",
  environment_added: "Environment added",
  environment_deleted: "Environment deleted",
  snapshot_deleted: "Snapshot deleted",
};

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(Math.round(durationMs / 1000), 0);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h ${totalMinutes % 60}m`;
}

function DateTimeStack({
  value,
  className = "",
}: {
  value: string;
  className?: string;
}) {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) {
    return (
      <span className={`block leading-tight text-black/40 dark:text-white/40 ${className}`} title={value || "Missing timestamp"}>
        Date unavailable
      </span>
    );
  }

  const date = new Date(timestamp);
  return (
    <time dateTime={date.toISOString()} className={`block leading-tight ${className}`}>
      <span className="block whitespace-nowrap">{dateFormatter.format(date)}</span>
      <span className="mt-1 block whitespace-nowrap text-[11px] opacity-70">
        {timeFormatter.format(date)}
      </span>
    </time>
  );
}

const actionIconProps = {
  width: 13,
  height: 13,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function WorkflowIcon() {
  return <svg {...actionIconProps}><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M8 6h8M7.5 7.5l3.2 8M16.5 7.5l-3.2 8" /></svg>;
}

function DetailsIcon() {
  return <svg {...actionIconProps}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;
}

function OpenIcon() {
  return <svg {...actionIconProps}><path d="M14 5h5v5M19 5l-8 8" /><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>;
}

function hasAttention(operation: CatalogOperationListItem) {
  return Boolean(
    operation.error || operation.warnings.length > 0 || operation.manualActions.length > 0,
  );
}

function SortButton({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title={`Sort by ${label.toLocaleLowerCase("en-US")}`}
      className="inline-flex max-w-full items-center gap-0.5 overflow-hidden text-left font-semibold leading-tight text-black/50 transition hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:text-white/50 dark:hover:text-white"
    >
      <span className="truncate">{label}</span>
      <span aria-hidden="true" className={`shrink-0 ${active ? "text-emerald-600 dark:text-emerald-400" : "text-black/20 dark:text-white/20"}`}>
        {active ? sort.direction === "asc" ? "↑" : "↓" : "↕"}
      </span>
    </button>
  );
}

function OperationStatusBadge({ operation }: { operation: CatalogOperationListItem }) {
  const { t } = useAppI18n();
  const active = operation.status === "queued" || operation.status === "running";
  const label = t({
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  }[operation.status]);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${statusStyles[operation.status]}`}>
      {active ? <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {label}
    </span>
  );
}

function OperationDetailsModal({
  operation,
  onClose,
}: {
  operation: CatalogOperationListItem;
  onClose: () => void;
}) {
  const { t } = useAppI18n();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`operation-details-title-${operation.id}`}
        className="flex max-h-[min(54rem,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/12 bg-white shadow-2xl dark:bg-neutral-950"
      >
        <header className="border-b border-black/8 px-6 pt-6 pb-4 sm:px-7 sm:pt-7 dark:border-white/8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${kindStyles[operation.kind]}`}>
                  {t(kindLabels[operation.kind])}
                </span>
                <OperationStatusBadge operation={operation} />
              </div>
              <h2
                id={`operation-details-title-${operation.id}`}
                className="mt-3 text-2xl font-semibold tracking-[-0.03em]"
              >
                {operation.title} #{operation.id}
              </h2>
              <p className="mt-2 text-sm text-black/50 dark:text-white/50">
                {operation.environmentName} · {operation.channelName}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close operation details"
              className="grid size-9 shrink-0 place-items-center rounded-full border border-black/10 text-lg text-black/45 transition hover:bg-black/5 hover:text-black focus:outline-none focus:ring-4 focus:ring-emerald-500/15 dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
            >
              ×
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 sm:px-7">
          {operation.showProgress ? <section aria-labelledby={`operation-progress-title-${operation.id}`}>
            <div className="flex items-center justify-between gap-4">
              <h3 id={`operation-progress-title-${operation.id}`} className="text-sm font-semibold">
                Progress
              </h3>
              <span className="text-xs font-semibold text-black/45 dark:text-white/45">
                {operation.progressPercent}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
              <div
                className={`h-full rounded-full ${operation.status === "failed" ? "bg-red-500" : operation.status === "cancelled" ? "bg-neutral-500" : "bg-emerald-500"}`}
                style={{ width: `${operation.progressPercent}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-black/55 dark:text-white/55">
              {t(operation.currentStep)}
            </p>
          </section> : (
            <section aria-labelledby={`operation-details-summary-title-${operation.id}`}>
              <h3 id={`operation-details-summary-title-${operation.id}`} className="text-sm font-semibold">Details</h3>
              <p className="mt-2 text-sm text-black/55 dark:text-white/55">{t(operation.currentStep)}</p>
            </section>
          )}

          <dl className="grid gap-3 rounded-2xl border border-black/8 bg-black/[0.025] p-4 sm:grid-cols-2 dark:border-white/8 dark:bg-white/[0.025]">
            <div><dt className="text-xs text-black/40 dark:text-white/40">Started</dt><dd className="mt-1 text-sm">{formatDateTime(operation.createdAt)}</dd></div>
            <div><dt className="text-xs text-black/40 dark:text-white/40">Last update</dt><dd className="mt-1 text-sm">{formatDateTime(operation.updatedAt)}</dd></div>
            <div><dt className="text-xs text-black/40 dark:text-white/40">Duration</dt><dd className="mt-1 text-sm">{formatDuration(operation.durationMs)}</dd></div>
            <div><dt className="text-xs text-black/40 dark:text-white/40">Snapshot</dt><dd className="mt-1 text-sm">{operation.snapshotName}{operation.snapshotVersion ? ` · version ${operation.snapshotVersion}` : ""}</dd></div>
          </dl>

          {operation.metrics.length > 0 ? (
            <section aria-labelledby={`operation-results-title-${operation.id}`}>
              <h3 id={`operation-results-title-${operation.id}`} className="text-sm font-semibold">Results</h3>
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {operation.metrics.map((item) => (
                  <div key={item.label} className="rounded-xl border border-black/8 p-3 dark:border-white/8">
                    <dt className="text-[11px] text-black/40 dark:text-white/40">{item.label}</dt>
                    <dd className="mt-1 text-lg font-semibold">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {operation.restoreGroups.length > 0 ? (
            <section aria-labelledby={`operation-sections-title-${operation.id}`}>
              <h3 id={`operation-sections-title-${operation.id}`} className="text-sm font-semibold">Restore sections</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {operation.restoreGroups.map((group) => (
                  <span key={group} className="rounded-full border border-black/10 px-2.5 py-1 text-xs capitalize text-black/55 dark:border-white/10 dark:text-white/55">
                    {group.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {operation.warnings.length > 0 ? (
            <section className="rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4" aria-labelledby={`operation-warnings-title-${operation.id}`}>
              <h3 id={`operation-warnings-title-${operation.id}`} className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                {operation.warnings.length} warning{operation.warnings.length === 1 ? "" : "s"}
              </h3>
              <ul className="mt-2 space-y-1.5 text-xs leading-5 text-amber-950/70 dark:text-amber-100/70">
                {operation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </section>
          ) : null}

          {operation.manualActions.length > 0 ? (
            <section className="rounded-2xl border border-blue-500/25 bg-blue-500/8 p-4" aria-labelledby={`operation-actions-title-${operation.id}`}>
              <h3 id={`operation-actions-title-${operation.id}`} className="text-sm font-semibold text-blue-800 dark:text-blue-200">Manual actions</h3>
              <div className="mt-3 space-y-3">
                {operation.manualActions.map((action) => (
                  <div key={`${action.href}-${action.label}`}>
                    <p className="text-xs leading-5 text-blue-950/70 dark:text-blue-100/70">{action.description}</p>
                    <a href={action.href} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-md border border-blue-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-500/10 dark:text-blue-300">
                      {action.label} ↗
                    </a>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {operation.error ? (
            <section className="rounded-2xl border border-red-500/25 bg-red-500/8 p-4" aria-labelledby={`operation-error-title-${operation.id}`}>
              <h3 id={`operation-error-title-${operation.id}`} className="text-sm font-semibold text-red-800 dark:text-red-200">Error</h3>
              <p className="mt-2 text-xs leading-5 text-red-950/70 dark:text-red-100/70">{operation.error}</p>
            </section>
          ) : null}

          <details className="rounded-2xl border border-black/8 p-4 dark:border-white/8">
            <summary className="cursor-pointer text-sm font-semibold">Technical details</summary>
            <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
              <div><dt className="text-black/40 dark:text-white/40">Ledger record</dt><dd className="mt-1 font-mono">{operation.activityKey}</dd></div>
              <div><dt className="text-black/40 dark:text-white/40">Workflow run ID</dt><dd className="mt-1 break-all font-mono">{operation.workflowRunId || "—"}</dd></div>
              <div><dt className="text-black/40 dark:text-white/40">Environment ID</dt><dd className="mt-1 font-mono">{operation.environmentId ?? "—"}</dd></div>
              <div><dt className="text-black/40 dark:text-white/40">Channel ID</dt><dd className="mt-1 font-mono">{operation.channelId ?? "—"}</dd></div>
              <div><dt className="text-black/40 dark:text-white/40">Snapshot ID</dt><dd className="mt-1 font-mono">{operation.snapshotId ?? "—"}</dd></div>
              <div><dt className="text-black/40 dark:text-white/40">Workflow steps</dt><dd className="mt-1 font-mono">{operation.stepIndex} / {operation.totalSteps}</dd></div>
            </dl>
          </details>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-black/8 px-6 py-4 sm:px-7 dark:border-white/8">
          <div className="flex flex-wrap items-center gap-4">
            {operation.workflowRunId ? (
              <Link href={`/operations/workflows?operation=${operation.id}`} onClick={onClose} className="text-sm font-semibold text-sky-700 hover:text-sky-800 dark:text-sky-300 dark:hover:text-sky-200">
                Open workflow →
              </Link>
            ) : null}
            {operation.resourceHref ? (
              <Link href={operation.resourceHref} onClick={onClose} className="text-sm font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200">
                {t(operation.resourceLabel)} →
              </Link>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">
            Close
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function CatalogOperationsTable({
  operations,
  generatedAt,
}: {
  operations: CatalogOperationListItem[];
  generatedAt: string;
}) {
  const router = useRouter();
  const { t } = useAppI18n();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | OperationKind>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [environment, setEnvironment] = useState("all");
  const [attention, setAttention] = useState<AttentionFilter>("all");
  const [dateRange, setDateRange] = useState<DateFilter>("all");
  const [sort, setSort] = useState<SortState>({ key: "updatedAt", direction: "desc" });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const closeDetails = useCallback(() => setSelectedKey(null), []);
  const selectedOperation = selectedKey === null
    ? null
    : operations.find((operation) => operation.activityKey === selectedKey) ?? null;
  const hasActiveOperations = operations.some((operation) =>
    operation.status === "queued" || operation.status === "running");

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(refresh, hasActiveOperations ? 10_000 : 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [hasActiveOperations, router]);

  const environments = useMemo(() => [...new Set(
    operations.map((operation) => operation.environmentName).filter((name) => name !== "—"),
  )].toSorted(collator.compare), [operations]);

  const filteredOperations = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("en-US");
    const now = parseTimestamp(generatedAt) ?? 0;
    const dateThreshold = dateRange === "today"
      ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      : dateRange === "7d" ? now - 7 * 86_400_000
        : dateRange === "30d" ? now - 30 * 86_400_000 : 0;
    const compare = (left: CatalogOperationListItem, right: CatalogOperationListItem) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      const values: Record<SortKey, [string | number, string | number]> = {
        id: [left.id, right.id],
        kind: [left.kind, right.kind],
        status: [left.status, right.status],
        target: [`${left.environmentName} ${left.channelName}`, `${right.environmentName} ${right.channelName}`],
        snapshot: [left.snapshotName, right.snapshotName],
        progress: [left.progressPercent, right.progressPercent],
        updatedAt: [parseTimestamp(left.updatedAt) ?? Number.NEGATIVE_INFINITY, parseTimestamp(right.updatedAt) ?? Number.NEGATIVE_INFINITY],
        duration: [left.durationMs, right.durationMs],
      };
      const [leftValue, rightValue] = values[sort.key];
      return direction * (typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : collator.compare(String(leftValue), String(rightValue)));
    };

    return operations.filter((operation) => {
      if (kind !== "all" && operation.kind !== kind) return false;
      if (status === "active" && operation.status !== "queued" && operation.status !== "running") return false;
      if (status !== "all" && status !== "active" && operation.status !== status) return false;
      if (environment !== "all" && operation.environmentName !== environment) return false;
      if (attention === "attention" && !hasAttention(operation)) return false;
      if (attention === "clean" && hasAttention(operation)) return false;
      const updatedAt = parseTimestamp(operation.updatedAt);
      if (dateThreshold && (updatedAt === null || updatedAt < dateThreshold)) return false;
      if (!normalizedQuery) return true;
      return [
        operation.id,
        operation.title,
        operation.status,
        operation.environmentName,
        operation.channelName,
        operation.snapshotName,
        operation.currentStep,
        operation.error,
        ...operation.warnings,
      ].some((value) => String(value ?? "").toLocaleLowerCase("en-US").includes(normalizedQuery));
    }).toSorted(compare);
  }, [attention, dateRange, environment, generatedAt, kind, operations, query, sort, status]);

  const hasFilters = Boolean(
    query || kind !== "all" || status !== "all" || environment !== "all" ||
    attention !== "all" || dateRange !== "all",
  );
  const changeSort = (key: SortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "updatedAt" || key === "duration" || key === "progress" || key === "id" ? "desc" : "asc" });
  };
  const resetFilters = () => {
    setQuery("");
    setKind("all");
    setStatus("all");
    setEnvironment("all");
    setAttention("all");
    setDateRange("all");
  };

  return (
    <>
      <section aria-label="Operation filters" className="rounded-2xl border border-black/8 bg-white/55 p-4 dark:border-white/8 dark:bg-white/3">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(14rem,1.5fr)_repeat(5,minmax(8rem,1fr))]">
          <label className="block">
            <span className="sr-only">Search operations</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search operations…" className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-white/10 dark:bg-white/5" />
          </label>
          <label className="block"><span className="sr-only">Operation type</span><select value={kind} onChange={(event) => setKind(event.target.value as "all" | OperationKind)} className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-emerald-500 dark:border-white/10 dark:bg-neutral-900"><option value="all">All types</option><option value="snapshot">Snapshot capture</option><option value="restore">Snapshot restore</option><option value="refresh">Clear &amp; Restore</option><option value="clear">Catalog clear</option><option value="database_sync">Database sync</option><option value="version_published">Version published</option><option value="version_unpublished">Version unpublished</option><option value="version_deleted">Version deleted</option><option value="snapshot_renamed">Snapshot renamed</option><option value="snapshot_deleted">Snapshot deleted</option><option value="environment_added">Environment added</option><option value="environment_deleted">Environment deleted</option></select></label>
          <label className="block"><span className="sr-only">Operation status</span><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-emerald-500 dark:border-white/10 dark:bg-neutral-900"><option value="all">All statuses</option><option value="active">Active</option><option value="queued">Queued</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select></label>
          <label className="block"><span className="sr-only">Environment</span><select value={environment} onChange={(event) => setEnvironment(event.target.value)} className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-emerald-500 dark:border-white/10 dark:bg-neutral-900"><option value="all">All environments</option>{environments.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          <label className="block"><span className="sr-only">Attention required</span><select value={attention} onChange={(event) => setAttention(event.target.value as AttentionFilter)} className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-emerald-500 dark:border-white/10 dark:bg-neutral-900"><option value="all">Any outcome</option><option value="attention">Needs attention</option><option value="clean">No warnings</option></select></label>
          <label className="block"><span className="sr-only">Updated date</span><select value={dateRange} onChange={(event) => setDateRange(event.target.value as DateFilter)} className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none focus:border-emerald-500 dark:border-white/10 dark:bg-neutral-900"><option value="all">Any date</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-black/45 dark:text-white/45">
          <p>{numberFormatter.format(filteredOperations.length)} of {numberFormatter.format(operations.length)} operations</p>
          {hasFilters ? <button type="button" onClick={resetFilters} className="font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200">Reset filters</button> : null}
        </div>
      </section>

      <div className="mt-4 min-w-0 overflow-hidden rounded-2xl border border-black/8 bg-white/55 dark:border-white/8 dark:bg-white/3">
        <div className="min-w-0 overflow-hidden">
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[4.5%]" />
              <col className="w-[10.5%]" />
              <col className="w-[9%]" />
              <col className="w-[14%]" />
              <col className="w-[11.5%]" />
              <col className="w-[23%]" />
              <col className="w-[10%]" />
              <col className="w-[6.5%]" />
              <col className="w-[11%]" />
            </colgroup>
            <thead className="border-b border-black/8 bg-black/[0.025] dark:border-white/8 dark:bg-white/[0.025]">
              <tr>
                <th scope="col" aria-sort={sort.key === "id" ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="overflow-hidden px-2 py-3"><SortButton label="ID" sortKey="id" sort={sort} onSort={changeSort} /></th>
                <th scope="col" aria-sort={sort.key === "kind" ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="overflow-hidden px-2 py-3"><SortButton label="Operation" sortKey="kind" sort={sort} onSort={changeSort} /></th>
                <th scope="col" aria-sort={sort.key === "status" ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="overflow-hidden px-2 py-3"><SortButton label="Status" sortKey="status" sort={sort} onSort={changeSort} /></th>
                <th scope="col" aria-sort={sort.key === "target" ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="overflow-hidden px-2 py-3"><SortButton label="Environment / channel" sortKey="target" sort={sort} onSort={changeSort} /></th>
                <th scope="col" aria-sort={sort.key === "snapshot" ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="overflow-hidden px-2 py-3"><SortButton label="Snapshot" sortKey="snapshot" sort={sort} onSort={changeSort} /></th>
                <th scope="col" aria-sort={sort.key === "progress" ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="overflow-hidden px-2 py-3"><SortButton label="Progress / result" sortKey="progress" sort={sort} onSort={changeSort} /></th>
                <th scope="col" aria-sort={sort.key === "updatedAt" ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="overflow-hidden px-2 py-3"><SortButton label="Last update" sortKey="updatedAt" sort={sort} onSort={changeSort} /></th>
                <th scope="col" aria-sort={sort.key === "duration" ? sort.direction === "asc" ? "ascending" : "descending" : "none"} className="overflow-hidden px-2 py-3"><SortButton label="Duration" sortKey="duration" sort={sort} onSort={changeSort} /></th>
                <th scope="col" className="px-2 py-3 text-right font-semibold text-black/50 dark:text-white/50">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/6 dark:divide-white/6">
              {filteredOperations.map((operation) => (
                <tr
                  key={operation.activityKey}
                  onDoubleClick={(event) => {
                    if ((event.target as HTMLElement).closest("a, button")) return;
                    setSelectedKey(operation.activityKey);
                  }}
                  title="Double-click to view details"
                  className="align-middle transition hover:bg-black/[0.025] dark:hover:bg-white/[0.025]"
                >
                  <td className="overflow-hidden px-2 py-3 font-mono text-black/40 dark:text-white/40"><span className="block truncate">#{operation.id}</span></td>
                  <td className="overflow-hidden px-2 py-3"><span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${kindStyles[operation.kind]}`} title={operation.title}><span className="truncate">{operation.title}</span></span><DateTimeStack value={operation.createdAt} className="mt-1.5 text-[11px] text-black/35 dark:text-white/35" /></td>
                  <td className="overflow-hidden px-2 py-3"><OperationStatusBadge operation={operation} />{hasAttention(operation) ? <span className="mt-1.5 block truncate text-[11px] font-medium text-amber-700 dark:text-amber-300" title="Needs attention">Needs attention</span> : null}</td>
                  <td className="overflow-hidden px-2 py-3"><p className="truncate font-medium" title={operation.environmentName}>{operation.environmentName}</p><p className="mt-1 truncate text-black/45 dark:text-white/45" title={operation.channelName}>{operation.channelName}</p></td>
                  <td className="overflow-hidden px-2 py-3"><p className="truncate font-medium" title={operation.snapshotName}>{operation.snapshotName}</p>{operation.snapshotVersion ? <p className="mt-1 truncate text-black/45 dark:text-white/45">Version {operation.snapshotVersion}</p> : null}</td>
                  <td className="overflow-hidden px-2 py-3" title={t(operation.currentStep)}>{operation.showProgress ? <><div className="flex min-w-0 items-center justify-between gap-2"><span className="block min-w-0 truncate text-black/55 dark:text-white/55">{t(operation.currentStep)}</span><span className="shrink-0 font-semibold">{operation.progressPercent}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/8 dark:bg-white/10"><div className={`h-full rounded-full ${operation.status === "failed" ? "bg-red-500" : operation.status === "cancelled" ? "bg-neutral-500" : "bg-emerald-500"}`} style={{ width: `${operation.progressPercent}%` }} /></div></> : <span className="block truncate text-black/55 dark:text-white/55">{t(operation.currentStep)}</span>}</td>
                  <td className="overflow-hidden px-2 py-3 text-black/50 dark:text-white/50"><DateTimeStack value={operation.updatedAt} /></td>
                  <td className="overflow-hidden whitespace-nowrap px-2 py-3 font-medium"><span className="block truncate">{formatDuration(operation.durationMs)}</span></td>
                  <td className="px-2 py-3"><div className="flex items-center justify-end gap-1">{operation.workflowRunId ? <Link href={`/operations/workflows?operation=${operation.id}`} aria-label={`Open workflow for ${operation.title}`} title="Open workflow" className="grid size-6 shrink-0 place-items-center rounded-md border border-sky-500/25 text-sky-700 transition hover:bg-sky-500/8 dark:text-sky-300"><WorkflowIcon /></Link> : null}<button type="button" onClick={() => setSelectedKey(operation.activityKey)} aria-label={`View details for ${operation.title}`} title="View details" className="grid size-6 shrink-0 place-items-center rounded-md border border-black/10 transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"><DetailsIcon /></button>{operation.resourceHref ? <Link href={operation.resourceHref} aria-label={`${t(operation.resourceLabel)} for ${operation.title}`} title={t(operation.resourceLabel)} className="grid size-6 shrink-0 place-items-center rounded-md border border-black/10 text-emerald-700 transition hover:bg-emerald-500/8 dark:border-white/10 dark:text-emerald-300"><OpenIcon /></Link> : null}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredOperations.length === 0 ? (
          <div className="border-t border-black/8 px-6 py-14 text-center dark:border-white/8">
            <p className="font-medium">No operations match these filters.</p>
            <p className="mt-1 text-sm text-black/45 dark:text-white/45">Adjust or reset the filters to see more activity.</p>
          </div>
        ) : null}
      </div>

      {selectedOperation ? <OperationDetailsModal operation={selectedOperation} onClose={closeDetails} /> : null}
    </>
  );
}
