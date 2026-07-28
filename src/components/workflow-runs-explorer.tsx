"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirmation } from "@/components/confirmation-provider";
import { useAppI18n } from "@/components/app-i18n-provider";
import type {
  WorkflowRunListItem,
  WorkflowStage,
  WorkflowStageStatus,
} from "@/lib/workflow-observability";

type StatusFilter = "all" | "active" | WorkflowRunListItem["appStatus"];
type KindFilter = "all" | WorkflowRunListItem["kind"];

const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const timeFormatter = new Intl.DateTimeFormat("en", { timeStyle: "short" });
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const statusStyles: Record<WorkflowRunListItem["appStatus"], string> = {
  queued: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  running: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  completed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/12 text-red-700 dark:text-red-300",
  cancelled: "bg-neutral-500/12 text-neutral-600 dark:text-neutral-300",
};

const stageStyles: Record<WorkflowStageStatus, string> = {
  pending: "border-black/10 bg-black/[0.025] text-black/40 dark:border-white/10 dark:bg-white/[0.025] dark:text-white/40",
  running: "border-sky-500/35 bg-sky-500/8 text-sky-800 dark:text-sky-200",
  completed: "border-emerald-500/30 bg-emerald-500/8 text-emerald-800 dark:text-emerald-200",
  failed: "border-red-500/35 bg-red-500/8 text-red-800 dark:text-red-200",
  cancelled: "border-neutral-500/25 bg-neutral-500/8 text-neutral-600 dark:text-neutral-300",
};

function formatDuration(milliseconds: number) {
  const seconds = Math.max(Math.round(milliseconds / 1_000), 0);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function DateTimeStack({ value }: { value: string }) {
  const date = new Date(value);
  return (
    <time dateTime={value} className="block leading-tight">
      <span className="block whitespace-nowrap">{dateFormatter.format(date)}</span>
      <span className="mt-1 block whitespace-nowrap text-[11px] text-black/40 dark:text-white/40">
        {timeFormatter.format(date)}
      </span>
    </time>
  );
}

function StatusBadge({ run }: { run: WorkflowRunListItem }) {
  const { t } = useAppI18n();
  const active = run.appStatus === "queued" || run.appStatus === "running";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${statusStyles[run.appStatus]}`}>
      {active ? <span className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {t(run.appStatus)}
    </span>
  );
}

function StageCard({ stage, index }: { stage: WorkflowStage; index: number }) {
  const { t } = useAppI18n();
  const restoreLabel = stage.label.match(/^Restore (.+)$/);
  const reconcileDescription = stage.description.match(
    /^Reconcile the (.+) section from the selected snapshot\.$/,
  );
  const sectionName = (value: string) =>
    t(value.replace(/\b\w/g, (letter) => letter.toUpperCase()));
  const label = restoreLabel
    ? t("Restore {section}", { section: sectionName(restoreLabel[1]) })
    : t(stage.label);
  const description = reconcileDescription
    ? t("Reconcile the {section} section from the selected snapshot.", {
        section: sectionName(reconcileDescription[1]),
      })
    : t(stage.description);
  return (
    <li className={`relative rounded-2xl border p-4 ${stageStyles[stage.status]}`}>
      <div className="flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-current/20 text-xs font-semibold">
          {stage.status === "completed" ? "✓" : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold capitalize">{label}</p>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">
              {t(stage.status)}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 opacity-70">{description}</p>
          {stage.progressPercent > 0 && stage.progressPercent < 100 ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-current/10">
              <div className="h-full rounded-full bg-current" style={{ width: `${stage.progressPercent}%` }} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function RunDetailsModal({
  run,
  busyAction,
  onAction,
  onClose,
}: {
  run: WorkflowRunListItem;
  busyAction: string | null;
  onAction: (run: WorkflowRunListItem, action: "refresh" | "cancel" | "retry") => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { t } = useAppI18n();
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", keydown);
    };
  }, [onClose]);

  return createPortal(
    <div
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
    >
      <section role="dialog" aria-modal="true" aria-labelledby={`workflow-title-${run.operationId}`} className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-black/10 bg-white shadow-2xl dark:border-white/12 dark:bg-neutral-950">
        <header className="border-b border-black/8 px-6 py-6 sm:px-8 dark:border-white/8">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-violet-500/12 px-2 py-1 text-[11px] font-semibold capitalize text-violet-700 dark:text-violet-300">{t(run.kind === "refresh" ? "Clear & Restore" : run.kind)}</span>
                <StatusBadge run={run} />
                {run.runtimeStatus && run.runtimeStatus !== run.appStatus ? (
                  <span className="rounded-full border border-amber-500/25 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    Runtime: {run.runtimeStatus}
                  </span>
                ) : null}
              </div>
              <h2 id={`workflow-title-${run.operationId}`} className="mt-3 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                {t(run.workflowName)}
              </h2>
              <p className="mt-2 text-sm text-black/50 dark:text-white/50">
                Operation #{run.operationId} · {run.environmentName} · {run.channelName}
              </p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close workflow details" className="grid size-10 shrink-0 place-items-center rounded-full border border-black/10 text-xl text-black/45 transition hover:bg-black/5 hover:text-black dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white">×</button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6 sm:px-8">
          <section>
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold">Execution progress</h3>
              <span className="text-sm font-semibold text-black/45 dark:text-white/45">{run.progressPercent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
              <div className={`h-full rounded-full ${run.appStatus === "failed" ? "bg-red-500" : run.appStatus === "cancelled" ? "bg-neutral-500" : "bg-emerald-500"}`} style={{ width: `${run.progressPercent}%` }} />
            </div>
            <p className="mt-2 text-sm text-black/55 dark:text-white/55">{t(run.currentStep)}</p>
          </section>

          <section>
            <h3 className="font-semibold">Workflow trace</h3>
            <ol className="mt-3 grid gap-3 lg:grid-cols-2">
              {run.stages.map((stage, index) => <StageCard key={stage.id} stage={stage} index={index} />)}
            </ol>
          </section>

          <dl className="grid gap-3 rounded-2xl border border-black/8 bg-black/[0.025] p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-white/8 dark:bg-white/[0.025]">
            <div><dt className="text-xs text-black/40 dark:text-white/40">Created</dt><dd className="mt-1 text-sm"><DateTimeStack value={run.createdAt} /></dd></div>
            <div><dt className="text-xs text-black/40 dark:text-white/40">Last heartbeat</dt><dd className="mt-1 text-sm"><DateTimeStack value={run.updatedAt} /></dd></div>
            <div><dt className="text-xs text-black/40 dark:text-white/40">Duration</dt><dd className="mt-1 text-sm">{formatDuration(run.durationMs)}</dd></div>
            <div><dt className="text-xs text-black/40 dark:text-white/40">Checkpoint</dt><dd className="mt-1 text-sm">{run.stepIndex} / {run.totalSteps || "—"}</dd></div>
          </dl>

          {(run.payloadSummary.length > 0 || run.resultSummary.length > 0) ? (
            <section className="grid gap-4 lg:grid-cols-2">
              {[{ title: "Input", values: run.payloadSummary }, { title: "Result", values: run.resultSummary }].map((group) => (
                <div key={group.title} className="rounded-2xl border border-black/8 p-4 dark:border-white/8">
                  <h3 className="text-sm font-semibold">{group.title}</h3>
                  {group.values.length > 0 ? <dl className="mt-3 space-y-2 text-xs">{group.values.map((entry) => <div key={entry.label} className="flex justify-between gap-4"><dt className="capitalize text-black/45 dark:text-white/45">{t(entry.label.replace(/\b\w/g, (letter) => letter.toUpperCase()))}</dt><dd className="text-right font-medium">{t(entry.value)}</dd></div>)}</dl> : <p className="mt-3 text-xs text-black/40 dark:text-white/40">No structured values recorded.</p>}
                </div>
              ))}
            </section>
          ) : null}

          {run.error ? <section className="rounded-2xl border border-red-500/25 bg-red-500/8 p-4"><h3 className="text-sm font-semibold text-red-800 dark:text-red-200">Failure</h3><p className="mt-2 text-xs leading-5 text-red-950/70 dark:text-red-100/70">{run.error}</p></section> : null}
          {run.manualActionCount > 0 ? <section className="rounded-2xl border border-blue-500/25 bg-blue-500/8 p-4 text-sm text-blue-800 dark:text-blue-200">{run.manualActionCount} manual follow-up action{run.manualActionCount === 1 ? "" : "s"} recorded. Open the related operation for full instructions.</section> : null}

          <details className="rounded-2xl border border-black/8 p-4 dark:border-white/8">
            <summary className="cursor-pointer text-sm font-semibold">Technical details</summary>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
              <div><dt className="text-black/40 dark:text-white/40">Workflow run ID</dt><dd className="mt-1 break-all font-mono">{run.workflowRunId}</dd></div>
              <div><dt className="text-black/40 dark:text-white/40">Runtime workflow name</dt><dd className="mt-1 break-all font-mono">{run.workflowRuntimeName}</dd></div>
              <div><dt className="text-black/40 dark:text-white/40">Runtime metadata</dt><dd className="mt-1">{run.runtimeAvailable ? "Available" : run.runtimeError || "Archived"}</dd></div>
              <div><dt className="text-black/40 dark:text-white/40">Application status</dt><dd className="mt-1 font-mono">{run.appStatus}</dd></div>
              <div><dt className="text-black/40 dark:text-white/40">Runtime status</dt><dd className="mt-1 font-mono">{run.runtimeStatus ?? "—"}</dd></div>
            </dl>
          </details>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-black/8 px-6 py-4 sm:px-8 dark:border-white/8">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => navigator.clipboard.writeText(run.workflowRunId)} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">Copy run ID</button>
            <button disabled={busyAction !== null} type="button" onClick={() => onAction(run, "refresh")} className="rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold transition hover:bg-black/5 disabled:opacity-45 dark:border-white/10 dark:hover:bg-white/5">{busyAction === "refresh" ? "Refreshing…" : "Refresh status"}</button>
            {run.canCancel ? <button disabled={busyAction !== null} type="button" onClick={() => onAction(run, "cancel")} className="rounded-xl border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-500/8 disabled:opacity-45 dark:text-red-300">{busyAction === "cancel" ? "Cancelling…" : "Cancel workflow"}</button> : null}
            {run.canRetry ? <button disabled={busyAction !== null} type="button" onClick={() => onAction(run, "retry")} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-45">{busyAction === "retry" ? "Starting…" : "Retry as new run"}</button> : null}
          </div>
          {run.resourceHref ? <Link href={run.resourceHref} onClick={onClose} className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{run.resourceLabel} →</Link> : null}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function WorkflowRunsExplorer({
  runs,
  initialSelectedOperationId = null,
}: {
  runs: WorkflowRunListItem[];
  initialSelectedOperationId?: number | null;
}) {
  const router = useRouter();
  const { t } = useAppI18n();
  const confirmation = useConfirmation();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedOperationId);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const active = runs.some((run) => run.canCancel);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [active, router]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return runs.filter((run) => {
      if (status === "active" && !run.canCancel) return false;
      if (status !== "all" && status !== "active" && run.appStatus !== status) return false;
      if (kind !== "all" && run.kind !== kind) return false;
      if (!needle) return true;
      return [run.workflowName, run.workflowRuntimeName, run.workflowRunId, run.environmentName, run.channelName, run.snapshotName, run.currentStep, String(run.operationId)]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    }).sort((left, right) => {
      const activeDelta = Number(right.canCancel) - Number(left.canCancel);
      return activeDelta || Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || collator.compare(right.workflowRunId, left.workflowRunId);
    });
  }, [kind, query, runs, status]);

  const selected = runs.find((run) => run.operationId === selectedId) ?? null;
  const closeModal = useCallback(() => {
    setSelectedId(null);
    if (initialSelectedOperationId) {
      router.replace("/operations/workflows", { scroll: false });
    }
  }, [initialSelectedOperationId, router]);

  const runAction = useCallback(async (run: WorkflowRunListItem, action: "refresh" | "cancel" | "retry") => {
    if (action === "cancel") {
      const confirmed = await confirmation({
        title: "Cancel this active workflow?",
        description: "The workflow will stop after its current durable checkpoint. Completed checkpoints remain available in the audit record.",
        confirmLabel: "Cancel workflow",
        tone: "danger",
      });
      if (!confirmed) return;
    }
    if (action === "retry") {
      const confirmed = await confirmation({
        title: "Retry this workflow?",
        description: "A new durable workflow run will start with the same stored input. The existing run remains in history.",
        confirmLabel: "Start new run",
        tone: "primary",
      });
      if (!confirmed) return;
    }
    setBusyAction(action);
    setActionError(null);
    try {
      const response = await fetch(`/api/workflows/${run.operationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as { error?: string; replacementOperationId?: number };
      if (!response.ok) throw new Error(result.error || "The workflow action failed.");
      if (result.replacementOperationId) setSelectedId(result.replacementOperationId);
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The workflow action failed.");
    } finally {
      setBusyAction(null);
    }
  }, [confirmation, router]);

  return (
    <div>
      <div className="flex flex-col gap-3 rounded-2xl border border-black/8 bg-white/35 p-3 lg:flex-row lg:items-center dark:border-white/8 dark:bg-white/[0.02]">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search workflows</span>
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-black/35 dark:text-white/35">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search runs, channels, snapshots, or run IDs…" className="h-10 w-full rounded-xl border border-black/10 bg-white/70 pr-3 pl-9 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-white/10 dark:bg-white/5" />
        </label>
        <div className="flex flex-wrap gap-2">
          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="Filter workflow status" className="h-10 rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold dark:border-white/10 dark:bg-neutral-900">
            <option value="all">All statuses</option><option value="active">Active</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option>
          </select>
          <select value={kind} onChange={(event) => setKind(event.target.value as KindFilter)} aria-label="Filter workflow type" className="h-10 rounded-xl border border-black/10 bg-white px-3 text-xs font-semibold dark:border-white/10 dark:bg-neutral-900">
            <option value="all">All workflows</option><option value="snapshot">Snapshot capture</option><option value="restore">Snapshot restore</option><option value="refresh">Clear &amp; Restore</option><option value="clear">Catalog clear</option>
          </select>
          <button type="button" onClick={() => router.refresh()} className="h-10 rounded-xl border border-black/10 px-3 text-xs font-semibold transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">Refresh</button>
        </div>
      </div>

      {actionError ? <div role="alert" className="mt-3 rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-sm text-red-700 dark:text-red-300">{actionError}</div> : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-black/8 dark:border-white/8">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[72rem] table-fixed text-left text-xs">
            <colgroup><col className="w-[15%]" /><col className="w-[10%]" /><col className="w-[18%]" /><col className="w-[26%]" /><col className="w-[11%]" /><col className="w-[10%]" /><col className="w-[10%]" /></colgroup>
            <thead className="bg-black/[0.035] text-black/50 dark:bg-white/[0.035] dark:text-white/50"><tr><th className="px-4 py-3 font-semibold">Workflow</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Resource</th><th className="px-4 py-3 font-semibold">Progress / checkpoint</th><th className="px-4 py-3 font-semibold">Last update</th><th className="px-4 py-3 font-semibold">Duration</th><th className="px-4 py-3 text-right font-semibold">Actions</th></tr></thead>
            <tbody className="divide-y divide-black/7 dark:divide-white/7">
              {filtered.map((run) => (
                <tr key={run.operationId} onDoubleClick={() => setSelectedId(run.operationId)} className="cursor-pointer bg-white/20 align-top transition hover:bg-emerald-500/[0.035] dark:bg-white/[0.012]">
                  <td className="px-4 py-3"><button type="button" onClick={() => setSelectedId(run.operationId)} className="block max-w-full text-left"><span className="block truncate font-semibold">{run.workflowName}</span><span className="mt-1 block truncate font-mono text-[10px] text-black/40 dark:text-white/40">{run.workflowRunId}</span><span className="mt-1 block text-[10px] text-black/35 dark:text-white/35">Operation #{run.operationId}</span></button></td>
                  <td className="px-4 py-3"><StatusBadge run={run} />{run.warningCount || run.manualActionCount ? <span className="mt-2 block text-[10px] font-semibold text-amber-600 dark:text-amber-300">{run.warningCount + run.manualActionCount} attention</span> : null}</td>
                  <td className="px-4 py-3"><span className="block truncate font-semibold">{run.environmentName}</span><span className="mt-1 block truncate text-black/45 dark:text-white/45">{run.channelName}</span><span className="mt-1 block truncate text-black/35 dark:text-white/35">{run.snapshotName}{run.snapshotVersion ? ` · v${run.snapshotVersion}` : ""}</span></td>
                  <td className="px-4 py-3"><div className="flex items-start justify-between gap-3"><span title={t(run.currentStep)} className="block min-w-0 flex-1 truncate text-black/55 dark:text-white/55">{t(run.currentStep)}</span><strong>{run.progressPercent}%</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/8 dark:bg-white/10"><div className={`h-full rounded-full ${run.appStatus === "failed" ? "bg-red-500" : run.appStatus === "cancelled" ? "bg-neutral-500" : "bg-emerald-500"}`} style={{ width: `${run.progressPercent}%` }} /></div><span className="mt-1 block text-[10px] text-black/35 dark:text-white/35">Checkpoint {run.stepIndex} / {run.totalSteps || "—"}</span></td>
                  <td className="px-4 py-3 text-black/55 dark:text-white/55"><DateTimeStack value={run.updatedAt} /></td>
                  <td className="px-4 py-3 font-medium">{formatDuration(run.durationMs)}</td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-1.5"><button type="button" onClick={() => setSelectedId(run.operationId)} className="rounded-lg border border-black/10 px-2.5 py-1.5 font-semibold transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">Inspect</button>{run.canCancel ? <button type="button" onClick={() => runAction(run, "cancel")} className="rounded-lg border border-red-500/25 px-2.5 py-1.5 font-semibold text-red-700 dark:text-red-300">Cancel</button> : null}{run.canRetry ? <button type="button" onClick={() => runAction(run, "retry")} className="rounded-lg border border-emerald-500/25 px-2.5 py-1.5 font-semibold text-emerald-700 dark:text-emerald-300">Retry</button> : null}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? <div className="px-6 py-14 text-center text-sm text-black/45 dark:text-white/45">No workflow runs match these filters.</div> : null}
      </div>

      {selected ? <RunDetailsModal run={selected} busyAction={busyAction} onAction={runAction} onClose={closeModal} /> : null}
    </div>
  );
}
