"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  removeSchedule,
  runScheduleNow,
  saveSchedule,
  toggleSchedule,
  type SchedulerActionState,
} from "@/app/(app)/scheduler/actions";
import { useConfirmation } from "@/components/confirmation-provider";
import { useAppI18n } from "@/components/app-i18n-provider";
import { SNAPSHOT_RESTORE_GROUPS } from "@/lib/snapshot-configuration";
import type {
  CatalogSchedule,
  CatalogSnapshotRestoreOption,
} from "@/lib/db";
import type { CatalogRestoreDestination } from "@/lib/catalog-restore";

type ScheduleRow = CatalogSchedule & {
  environmentName: string;
  channelName: string;
  lastStatus: string | null;
};

type SchedulerSnapshotOption = CatalogSnapshotRestoreOption & {
  isFavorite: boolean;
};

const INITIAL_STATE: SchedulerActionState = { status: "idle", message: "" };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WIZARD_STEPS = ["Target & action", "Timing", "Review & save"] as const;
const snapshotNameCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

function getSnapshotSeriesKey(snapshot: { ownerUserId: string; name: string }) {
  return `${snapshot.ownerUserId}:${snapshot.name.normalize("NFKC").toLocaleLowerCase("en")}`;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function actionLabel(action: CatalogSchedule["action"]) {
  return action === "refresh" ? "Clear & Restore" :
    action === "snapshot" ? "Capture snapshot" :
      action === "restore" ? "Restore snapshot" : "Clear catalog";
}

const controlIconProps = {
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

function RunIcon() {
  return <svg {...controlIconProps} fill="currentColor" stroke="none"><path d="m8 5 11 7-11 7Z" /></svg>;
}

function EditIcon() {
  return <svg {...controlIconProps}><path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2Z" /><path d="m14.5 7.1 2.8 2.8M4 20h5" /></svg>;
}

function PauseIcon() {
  return <svg {...controlIconProps}><path d="M9 6v12M15 6v12" /></svg>;
}

function ResumeIcon() {
  return <svg {...controlIconProps}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>;
}

function DeleteIcon() {
  return <svg {...controlIconProps}><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>;
}

export function SchedulerWorkspace({
  schedules,
  destinations,
  snapshots,
  defaultTimezone,
  dispatchInterval,
}: {
  schedules: ScheduleRow[];
  destinations: CatalogRestoreDestination[];
  snapshots: SchedulerSnapshotOption[];
  defaultTimezone: string;
  dispatchInterval: "minute" | "daily";
}) {
  const confirmation = useConfirmation();
  const { t } = useAppI18n();
  const [availableDestinations, setAvailableDestinations] = useState(destinations);
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationsError, setDestinationsError] = useState("");
  const [editing, setEditing] = useState<CatalogSchedule | null | undefined>(undefined);
  const [step, setStep] = useState(1);
  const [action, setAction] = useState<CatalogSchedule["action"]>("refresh");
  const [environmentId, setEnvironmentId] = useState(destinations[0]?.id ?? 0);
  const [channelId, setChannelId] = useState(destinations[0]?.channels[0]?.id ?? 0);
  const [snapshotId, setSnapshotId] = useState(snapshots[0]?.id ?? 0);
  const [frequency, setFrequency] = useState<CatalogSchedule["frequency"]>("daily");
  const [scheduleName, setScheduleName] = useState("Nightly demo refresh");
  const [localTime, setLocalTime] = useState("02:00");
  const [weekday, setWeekday] = useState(0);
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [restoreGroups, setRestoreGroups] = useState<string[]>(["catalog"]);
  const [state, formAction, pending] = useActionState(saveSchedule, INITIAL_STATE);
  const [saving, startSaving] = useTransition();
  const [mutating, startTransition] = useTransition();
  const [, startToggleTransition] = useTransition();
  const [now, setNow] = useState<Date | null>(null);
  const [enabledBySchedule, setEnabledBySchedule] = useState<Record<number, boolean>>({});
  const [togglePendingIds, setTogglePendingIds] = useState<Set<number>>(() => new Set());
  const [toggleError, setToggleError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const destinationsRef = useRef(destinations);
  const destinationsRequestRef = useRef<Promise<CatalogRestoreDestination[]> | null>(null);
  const selectedEnvironment = availableDestinations.find((environment) => environment.id === environmentId);
  const selectedChannel = selectedEnvironment?.channels.find((channel) => channel.id === channelId);
  const selectedSnapshot = snapshots.find((snapshot) => snapshot.id === snapshotId);
  const snapshotSeries = useMemo(() => {
    const orderedSnapshots = [...snapshots].sort((left, right) => {
      const favoriteOrder = Number(right.isFavorite) - Number(left.isFavorite);
      if (favoriteOrder !== 0) return favoriteOrder;
      const nameOrder = snapshotNameCollator.compare(left.name, right.name);
      return nameOrder || right.snapshotVersion - left.snapshotVersion || right.id - left.id;
    });

    return orderedSnapshots.reduce<Array<{
      key: string;
      name: string;
      sourceChannelName: string;
      isFavorite: boolean;
      versions: SchedulerSnapshotOption[];
    }>>((series, option) => {
      const key = getSnapshotSeriesKey(option);
      const existing = series.find((candidate) => candidate.key === key);
      if (existing) {
        existing.versions.push(option);
      } else {
        series.push({
          key,
          name: option.name,
          sourceChannelName: option.sourceChannelName,
          isFavorite: option.isFavorite,
          versions: [option],
        });
      }
      return series;
    }, []);
  }, [snapshots]);
  const selectedSeriesKey = selectedSnapshot
    ? getSnapshotSeriesKey(selectedSnapshot)
    : snapshotSeries[0]?.key ?? "";
  const selectedSeriesVersions = snapshotSeries.find(
    (series) => series.key === selectedSeriesKey,
  )?.versions ?? [];
  const groups = SNAPSHOT_RESTORE_GROUPS.filter((group) =>
    group.id !== "channel" && selectedSnapshot?.availableRestoreGroups.includes(group.id),
  );
  const grouped = useMemo(() => {
    const result = new Map<string, ScheduleRow[]>();
    for (const schedule of schedules) {
      const rows = result.get(schedule.environmentName) ?? [];
      rows.push(schedule);
      result.set(schedule.environmentName, rows);
    }
    return [...result.entries()];
  }, [schedules]);
  const activeActionResources = useMemo(() => new Set(
    schedules
      .filter((schedule) => schedule.lastStatus === "queued" || schedule.lastStatus === "running")
      .map((schedule) => `${schedule.action}:${schedule.environmentId}:${schedule.channelId}`),
  ), [schedules]);

  useEffect(() => {
    if (state.status === "success") {
      queueMicrotask(() => setEditing(undefined));
    }
  }, [state]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  function toggleScheduleOptimistically(schedule: ScheduleRow) {
    if (togglePendingIds.has(schedule.id)) return;
    const currentEnabled = enabledBySchedule[schedule.id] ?? schedule.enabled;
    const nextEnabled = !currentEnabled;
    setToggleError("");
    setEnabledBySchedule((current) => ({ ...current, [schedule.id]: nextEnabled }));
    setTogglePendingIds((current) => new Set(current).add(schedule.id));
    startToggleTransition(async () => {
      const result = await toggleSchedule(schedule.id);
      if (result.error || result.enabled === null) {
        setEnabledBySchedule((current) => ({ ...current, [schedule.id]: currentEnabled }));
        setToggleError(result.error ?? t("The schedule could not be updated."));
      } else {
        setEnabledBySchedule((current) => ({ ...current, [schedule.id]: result.enabled! }));
      }
      setTogglePendingIds((current) => {
        const next = new Set(current);
        next.delete(schedule.id);
        return next;
      });
    });
  }

  const loadDestinations = useCallback(async () => {
    if (destinationsRef.current.length > 0) return destinationsRef.current;
    if (destinationsRequestRef.current) return destinationsRequestRef.current;

    const request = (async () => {
      const response = await fetch("/api/scheduler/destinations", {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as {
        destinations?: CatalogRestoreDestination[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(body.destinations)) {
        throw new Error(body.error ?? t("The live BigCommerce destinations could not be loaded."));
      }
      return body.destinations;
    })();

    destinationsRequestRef.current = request;
    setDestinationsLoading(true);
    setDestinationsError("");
    try {
      const nextDestinations = await request;
      destinationsRef.current = nextDestinations;
      setAvailableDestinations(nextDestinations);
      return nextDestinations;
    } catch (error) {
      setDestinationsError(
        error instanceof Error ? error.message : t("The live BigCommerce destinations could not be loaded."),
      );
      return [];
    } finally {
      destinationsRequestRef.current = null;
      setDestinationsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDestinations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDestinations]);

  function openSchedule(schedule?: CatalogSchedule, preset?: "refresh" | "backup") {
    setEditing(schedule ?? null);
    setStep(1);
    const nextAction = schedule?.action ?? (preset === "backup" ? "snapshot" : "refresh");
    const nextEnvironmentId = schedule?.environmentId ?? availableDestinations[0]?.id ?? 0;
    const nextEnvironment = availableDestinations.find((environment) => environment.id === nextEnvironmentId);
    setAction(nextAction);
    setEnvironmentId(nextEnvironmentId);
    setChannelId(schedule?.channelId ?? nextEnvironment?.channels[0]?.id ?? 0);
    setSnapshotId(schedule?.snapshotId ?? snapshots[0]?.id ?? 0);
    setFrequency(schedule?.frequency ?? (preset === "backup" ? "weekly" : "daily"));
    setScheduleName(schedule?.name ?? (nextAction === "snapshot" ? "Weekly catalog backup" : "Nightly demo refresh"));
    setLocalTime(schedule?.localTime ?? (nextAction === "snapshot" ? "03:00" : "02:00"));
    setWeekday(schedule?.weekday ?? 0);
    setTimezone(schedule?.timezone ?? defaultTimezone);
    setRestoreGroups(schedule?.restoreGroups.length ? schedule.restoreGroups : ["catalog"]);
    void loadDestinations().then((nextDestinations) => {
      const preferredEnvironment = nextDestinations.find(
        (environment) => environment.id === nextEnvironmentId,
      );
      const nextLoadedEnvironment = preferredEnvironment ?? nextDestinations[0];
      const preferredChannel = nextLoadedEnvironment?.channels.find(
        (channel) => channel.id === (schedule?.channelId ?? 0),
      );
      setEnvironmentId(nextLoadedEnvironment?.id ?? 0);
      setChannelId(preferredChannel?.id ?? nextLoadedEnvironment?.channels[0]?.id ?? 0);
    });
  }

  function selectEnvironment(nextEnvironmentId: number) {
    const environment = availableDestinations.find((candidate) => candidate.id === nextEnvironmentId);
    setEnvironmentId(nextEnvironmentId);
    setChannelId(environment?.channels[0]?.id ?? 0);
  }

  function selectSnapshot(nextSnapshotId: number) {
    const snapshot = snapshots.find((candidate) => candidate.id === nextSnapshotId);
    const available = new Set<string>(snapshot?.availableRestoreGroups ?? []);
    setSnapshotId(nextSnapshotId);
    setRestoreGroups((current) => {
      const retained = current.filter((group) => available.has(group));
      return retained.length > 0 ? retained : available.has("catalog") ? ["catalog"] : [];
    });
  }

  function validateStep(currentStep: number) {
    const panel = formRef.current?.querySelector<HTMLElement>(`[data-scheduler-step="${currentStep}"]`);
    const controls = panel?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select");
    if (!controls) return true;
    for (const control of controls) {
      if (!control.checkValidity()) {
        control.reportValidity();
        return false;
      }
    }
    return true;
  }

  function continueWizard() {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(3, current + 1));
  }

  function saveWizard() {
    const form = formRef.current;
    if (!form || !validateStep(3)) return;
    const formData = new FormData(form);
    startSaving(() => {
      formAction(formData);
    });
  }

  function toggleRestoreGroup(groupId: string, checked: boolean) {
    setRestoreGroups((current) => checked
      ? [...new Set([...current, groupId])]
      : current.filter((candidate) => candidate !== groupId));
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 pb-6 dark:border-white/10">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => openSchedule(undefined, "refresh")} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">
            + Nightly refresh
          </button>
          <button type="button" onClick={() => openSchedule(undefined, "backup")} className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-500/12 dark:text-emerald-300">
            + Weekly backup
          </button>
          <button type="button" onClick={() => openSchedule()} className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5">
            + Custom schedule
          </button>
        </div>
        <div className="text-right text-xs text-black/45 dark:text-white/45">
          <p>
            Due schedules are dispatched {dispatchInterval === "minute" ? "every minute" : "once per day"}.
          </p>
          {process.env.NODE_ENV === "development" ? (
            <p className="mt-1">Local checks run while this application is open.</p>
          ) : null}
          <p className="mt-1 font-medium text-black/60 tabular-nums dark:text-white/60">
            Current time: {now ? new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "medium",
              timeZone: defaultTimezone,
            }).format(now) : "—"} · {defaultTimezone}
          </p>
        </div>
      </div>

      {toggleError ? <p role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-700 dark:text-red-300">{toggleError}</p> : null}

      {schedules.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-black/15 p-12 text-center dark:border-white/15">
          <h2 className="text-lg font-semibold">No schedules yet</h2>
          <p className="mt-2 text-sm text-black/50 dark:text-white/50">Start with a nightly refresh for demo channels or a weekly backup snapshot.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-black/10 dark:border-white/10">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="bg-black/[0.03] text-black/45 dark:bg-white/[0.03] dark:text-white/45">
              <tr>
                <th className="w-[22%] px-4 py-3">Schedule / channel</th>
                <th className="w-[15%] px-4 py-3">Action</th>
                <th className="w-[18%] px-4 py-3">Cadence</th>
                <th className="w-[16%] px-4 py-3">Next run</th>
                <th className="w-[14%] px-4 py-3">Last result</th>
                <th className="w-[15%] px-4 py-3 text-right">Controls</th>
              </tr>
            </thead>
            <tbody>
              {grouped.flatMap(([environmentName, rows]) => [
                <tr key={`environment-${environmentName}`} className="border-t border-black/10 bg-emerald-500/[0.04] dark:border-white/10">
                  <th colSpan={6} className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-300">{environmentName}</th>
                </tr>,
                ...rows.map((schedule) => {
                  const scheduleEnabled = enabledBySchedule[schedule.id] ?? schedule.enabled;
                  const togglePending = togglePendingIds.has(schedule.id);
                  const actionResourceActive = activeActionResources.has(
                    `${schedule.action}:${schedule.environmentId}:${schedule.channelId}`,
                  );
                  return (
                  <tr key={schedule.id} className="border-t border-black/8 align-top hover:bg-black/[0.02] dark:border-white/8 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-3"><button type="button" onDoubleClick={() => openSchedule(schedule)} className="text-left"><span className="block font-semibold">{schedule.name}</span><span className="mt-1 block truncate text-black/45 dark:text-white/45">{schedule.channelName}</span></button></td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 font-semibold ${schedule.action === "refresh" ? "bg-blue-500/12 text-blue-700 dark:text-blue-300" : "bg-purple-500/12 text-purple-700 dark:text-purple-300"}`}>{actionLabel(schedule.action)}</span></td>
                    <td className="px-4 py-3"><span className="block font-medium">{t(schedule.frequency === "daily" ? "Daily" : WEEKDAYS[schedule.weekday ?? 0])}</span><span className="mt-1 block text-black/45 dark:text-white/45">{schedule.localTime} · {schedule.timezone}</span></td>
                    <td className="px-4 py-3"><span className={scheduleEnabled ? "" : "text-black/35 dark:text-white/35"}>{scheduleEnabled ? formatDate(schedule.nextRunAt) : "Paused"}</span></td>
                    <td className="px-4 py-3"><span className="block capitalize">{t(schedule.lastError ? "Needs attention" : schedule.lastStatus ?? "Not run")}</span>{schedule.lastRunAt ? <span className="mt-1 block text-black/45 dark:text-white/45">{formatDate(schedule.lastRunAt)}</span> : null}</td>
                    <td className="px-4 py-3"><div className="flex flex-nowrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={mutating || actionResourceActive}
                        onClick={() => startTransition(() => void runScheduleNow(schedule.id))}
                        className="grid size-6 shrink-0 place-items-center rounded-md border border-emerald-500/25 text-emerald-700 transition hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300"
                        aria-label={actionResourceActive
                          ? t("The same action is already running for {channel}", { channel: schedule.channelName })
                          : t("Run {name} now", { name: schedule.name })}
                        title={actionResourceActive ? "This action is already running for the channel" : "Run now"}
                      ><RunIcon /></button>
                      <button type="button" onClick={() => openSchedule(schedule)} className="grid size-6 shrink-0 place-items-center rounded-md border border-black/10 transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5" aria-label={t("Edit {title}", { title: schedule.name })} title="Edit schedule"><EditIcon /></button>
                      <button type="button" disabled={togglePending} onClick={() => toggleScheduleOptimistically(schedule)} className="grid size-6 shrink-0 place-items-center rounded-md border border-black/10 transition hover:bg-black/5 disabled:cursor-wait disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5" aria-label={t("{action} {target}", { action: t(scheduleEnabled ? "Pause" : "Resume"), target: schedule.name })} title={scheduleEnabled ? "Pause schedule" : "Resume schedule"}>{scheduleEnabled ? <PauseIcon /> : <ResumeIcon />}</button>
                      <button
                        type="button"
                        disabled={mutating}
                        onClick={async () => {
                          const confirmed = await confirmation({
                            title: t("Delete {name}?", { name: schedule.name }),
                            description: "This schedule will stop running and will be removed. Previous operation history is preserved.",
                            confirmLabel: "Delete schedule",
                            tone: "danger",
                          });
                          if (confirmed) startTransition(() => void removeSchedule(schedule.id));
                        }}
                        className="grid size-6 shrink-0 place-items-center rounded-md border border-red-500/20 text-red-600 transition hover:bg-red-500/10 disabled:opacity-40 dark:text-red-300"
                        aria-label={t("Delete {title}", { title: schedule.name })}
                        title="Delete schedule"
                      ><DeleteIcon /></button>
                    </div></td>
                  </tr>
                  );
                }),
              ])}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined ? (
        <div className="fixed inset-0 z-[200] grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Catalog schedule">
          <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="my-8 w-full max-w-4xl overflow-hidden rounded-3xl border border-white/12 bg-[#0d100e] text-white shadow-2xl">
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <input type="hidden" name="enabled" value={editing?.enabled === false ? "false" : "true"} />
            <header className="flex items-start justify-between border-b border-white/10 p-6">
              <div><p className="text-sm font-semibold text-emerald-400">Scheduler</p><h2 className="mt-1 text-2xl font-semibold">{editing ? "Edit schedule" : "Create a schedule"}</h2><p className="mt-2 text-sm text-white/50">One channel per schedule keeps failures, history, and ownership easy to understand.</p></div>
              <button type="button" onClick={() => setEditing(undefined)} className="grid size-10 place-items-center rounded-full border border-white/10 text-xl">×</button>
            </header>
            <nav aria-label="Schedule steps" className="grid grid-cols-3 gap-2 border-b border-white/10 px-6 py-4">
              {WIZARD_STEPS.map((label, index) => {
                const number = index + 1;
                const active = step === number;
                const complete = step > number;
                return <button key={label} type="button" onClick={() => complete && setStep(number)} disabled={!complete} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${active ? "bg-emerald-500/12 text-emerald-300" : complete ? "text-emerald-300 hover:bg-white/5" : "text-white/30"}`}><span className={`grid size-6 shrink-0 place-items-center rounded-full ${active || complete ? "bg-emerald-500 text-[#07120d]" : "bg-white/8"}`}>{complete ? "✓" : number}</span><span>{label}</span></button>;
              })}
            </nav>
            <div className="min-h-[410px] p-6">
              <section data-scheduler-step="1" hidden={step !== 1}>
                <div><h3 className="text-xl font-semibold">Choose the target and action</h3><p className="mt-1 text-sm text-white/45">Select one channel and the durable operation that should run.</p></div>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <label className="sm:col-span-2"><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Schedule name</span><input name="name" required maxLength={100} value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} className="mt-2 w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2.5" /></label>
                  <label><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Environment</span><select name="environmentId" value={environmentId} onChange={(event) => selectEnvironment(Number(event.target.value))} disabled={destinationsLoading || availableDestinations.length === 0} className="mt-2 w-full rounded-xl border border-white/12 bg-[#171a18] px-3 py-2.5 disabled:opacity-50">{availableDestinations.length === 0 ? <option value={environmentId}>{destinationsLoading ? "Loading environments…" : "No environments available"}</option> : availableDestinations.map((environment) => <option key={environment.id} value={environment.id}>{environment.isFavorite ? "★ " : ""}{environment.name}</option>)}</select></label>
                  <label><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Channel</span><select name="channelId" value={channelId} onChange={(event) => setChannelId(Number(event.target.value))} disabled={destinationsLoading || !selectedEnvironment?.channels.length} className="mt-2 w-full rounded-xl border border-white/12 bg-[#171a18] px-3 py-2.5 disabled:opacity-50">{!selectedEnvironment?.channels.length ? <option value={channelId}>{destinationsLoading ? "Loading channels…" : "No channels available"}</option> : selectedEnvironment.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.isFavorite ? "★ " : ""}{channel.name}</option>)}</select></label>
                  {destinationsError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200 sm:col-span-2"><span>{destinationsError}</span><button type="button" onClick={() => void loadDestinations()} className="shrink-0 rounded-lg border border-red-400/30 px-3 py-1.5 font-semibold hover:bg-red-500/10">Retry</button></div> : null}
                  <label className="sm:col-span-2"><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Action</span><select name="action" value={action} onChange={(event) => setAction(event.target.value as CatalogSchedule["action"])} className="mt-2 w-full rounded-xl border border-white/12 bg-[#171a18] px-3 py-2.5"><option value="refresh">Clear & Restore</option><option value="snapshot">Capture snapshot</option><option value="restore">Restore snapshot</option><option value="clear">Clear catalog</option></select></label>
                  {action === "snapshot" ? <label className="sm:col-span-2"><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Snapshot series name</span><input name="snapshotName" defaultValue={editing?.snapshotName ?? "Weekly backup"} required className="mt-2 w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2.5" /></label> : null}
                  {["restore", "refresh"].includes(action) ? <div className="grid gap-5 sm:col-span-2 sm:grid-cols-2">
                    <label><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Snapshot</span><select value={selectedSeriesKey} onChange={(event) => {
                      const nextSeries = snapshotSeries.find((series) => series.key === event.target.value);
                      const newestVersion = nextSeries?.versions[0];
                      if (newestVersion) selectSnapshot(newestVersion.id);
                    }} className="mt-2 w-full rounded-xl border border-white/12 bg-[#171a18] px-3 py-2.5">{snapshotSeries.map((series) => <option key={series.key} value={series.key}>{series.isFavorite ? "⭐ " : ""}{series.name} · {series.sourceChannelName}</option>)}</select></label>
                    <label><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Version</span><select name="snapshotId" value={snapshotId} onChange={(event) => selectSnapshot(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/12 bg-[#171a18] px-3 py-2.5">{selectedSeriesVersions.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshot.publishedAt ? "🌐 " : ""}Version {snapshot.snapshotVersion}{snapshot.publishedAt ? " · Published" : ""} · {formatDate(snapshot.createdAt)}</option>)}</select></label>
                  </div> : null}
                </div>
              </section>

              <section data-scheduler-step="2" hidden={step !== 2}>
                <div><h3 className="text-xl font-semibold">Choose when it runs</h3><p className="mt-1 text-sm text-white/45">Schedules use the selected timezone and remain stable across daylight-saving changes.</p></div>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <label><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Frequency</span><select name="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as CatalogSchedule["frequency"])} className="mt-2 w-full rounded-xl border border-white/12 bg-[#171a18] px-3 py-2.5"><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
                  <label><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Local time</span><input type="time" name="localTime" value={localTime} onChange={(event) => setLocalTime(event.target.value)} required className="mt-2 w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2.5" /></label>
                  {frequency === "weekly" ? <label><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Weekday</span><select name="weekday" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-white/12 bg-[#171a18] px-3 py-2.5">{WEEKDAYS.map((day, index) => <option key={day} value={index}>{t(day)}</option>)}</select></label> : null}
                  <label className={frequency === "daily" ? "sm:col-span-2" : ""}><span className="text-xs font-semibold uppercase tracking-wider text-white/45">Timezone</span><input name="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} required className="mt-2 w-full rounded-xl border border-white/12 bg-white/5 px-3 py-2.5" /></label>
                </div>
                <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-sm text-white/65"><span className="font-semibold text-emerald-300">Cadence preview</span><p className="mt-1">{frequency === "daily" ? "Every day" : t("Every {weekday}", { weekday: t(WEEKDAYS[weekday]) })} at {localTime || "—"} in {timezone || "—"}.</p></div>
              </section>

              <section data-scheduler-step="3" hidden={step !== 3}>
                <div><h3 className="text-xl font-semibold">Review and save</h3><p className="mt-1 text-sm text-white/45">Confirm the schedule and, when applicable, choose the snapshot sections to restore.</p></div>
                {["restore", "refresh"].includes(action) && groups.length > 0 ? <fieldset className="mt-6"><legend className="text-xs font-semibold uppercase tracking-wider text-white/45">Restore sections</legend><div className="mt-2 grid max-h-[260px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">{groups.map((group) => <label key={group.id} className={`flex gap-2 rounded-xl border p-3 ${restoreGroups.includes(group.id) ? "border-emerald-500/35 bg-emerald-500/[0.06]" : "border-white/10"}`}><input type="checkbox" name="restoreGroups" value={group.id} checked={restoreGroups.includes(group.id)} onChange={(event) => toggleRestoreGroup(group.id, event.target.checked)} /><span><span className="block text-sm font-semibold">{group.label}</span><span className="mt-1 block text-xs text-white/45">{group.description}</span></span></label>)}</div></fieldset> : null}
                <dl className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs uppercase tracking-wider text-white/35">Schedule</dt><dd className="mt-1 font-semibold">{scheduleName || "Untitled schedule"}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-white/35">Action</dt><dd className="mt-1 font-semibold">{actionLabel(action)}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-white/35">Destination</dt><dd className="mt-1 font-semibold">{selectedEnvironment?.name ?? "—"} · {selectedChannel?.name ?? "—"}</dd></div>
                  <div><dt className="text-xs uppercase tracking-wider text-white/35">Cadence</dt><dd className="mt-1 font-semibold">{frequency === "daily" ? t("Daily") : t(WEEKDAYS[weekday])} at {localTime} · {timezone}</dd></div>
                  {["restore", "refresh"].includes(action) ? <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wider text-white/35">Snapshot source</dt><dd className="mt-1 font-semibold">{selectedSnapshot ? `${selectedSnapshot.name} ${t("· version {version}", { version: selectedSnapshot.snapshotVersion })} · ${selectedSnapshot.sourceChannelName}` : "—"}</dd></div> : null}
                </dl>
                {state.status === "error" ? <p role="alert" className="mt-4 rounded-xl bg-red-500/12 p-3 text-sm text-red-300">{state.message}</p> : null}
              </section>
            </div>
            <footer className="flex items-center justify-between gap-2 border-t border-white/10 p-5">
              <button type="button" onClick={() => setEditing(undefined)} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold">Cancel</button>
              <div className="flex gap-2">{step > 1 ? <button type="button" onClick={() => setStep((current) => Math.max(1, current - 1))} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold">Back</button> : null}{step < 3 ? <button type="button" onClick={continueWizard} disabled={step === 1 && (destinationsLoading || Boolean(destinationsError) || !selectedEnvironment || !selectedChannel)} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">{step === 1 && destinationsLoading ? "Loading…" : "Continue"}</button> : <button type="button" onClick={saveWizard} disabled={pending || saving || (["restore", "refresh"].includes(action) && restoreGroups.length === 0)} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold disabled:opacity-50">{pending || saving ? "Saving…" : editing ? "Save changes" : "Create schedule"}</button>}</div>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  );
}
