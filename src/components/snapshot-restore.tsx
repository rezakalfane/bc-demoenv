"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  preflightSnapshotRestore,
  restoreSnapshot,
  type RestorePreflightActionState,
  type RestoreSnapshotActionState,
} from "@/app/(app)/snapshots/restore-actions";
import type { CatalogRestoreDestination } from "@/lib/catalog-restore";
import { finishCatalogOperation, startCatalogOperation, useCatalogOperationActive } from "@/components/catalog-operation-progress";
import { RestoreIcon } from "@/components/action-icons";
import {
  isSnapshotRestoreGroupRestorable,
  SNAPSHOT_RESTORE_GROUPS,
  type SnapshotRestoreGroup,
} from "@/lib/snapshot-configuration";

const initialState: RestoreSnapshotActionState = {
  status: "idle",
  message: "",
  result: null,
};

const initialPreflightState: RestorePreflightActionState = {
  status: "idle",
  message: "",
  snapshotId: null,
  destinationEnvironmentId: null,
  destinationChannelId: null,
  restoreGroups: [],
  result: null,
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const snapshotNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

const restoreWizardSteps = [
  { id: 1, label: "Destination" },
  { id: 2, label: "Restore sections" },
  { id: 3, label: "Review & confirm" },
] as const;

type RestoreWizardStep = (typeof restoreWizardSteps)[number]["id"];

function getSnapshotSeriesKey(snapshot: { ownerUserId: string; name: string }) {
  return `${snapshot.ownerUserId}:${snapshot.name.normalize("NFKC").toLocaleLowerCase("en")}`;
}

function defaultGroupsForSnapshot(availableGroups: SnapshotRestoreGroup[]) {
  return SNAPSHOT_RESTORE_GROUPS.filter(
    (group) =>
      group.defaultChecked &&
      isSnapshotRestoreGroupRestorable(group.id) &&
      availableGroups.includes(group.id),
  ).map((group) => group.id);
}

function RestoreSubmitButton({
  enabled,
  pending,
}: {
  enabled: boolean;
  pending: boolean;
}) {

  return (
    <button
      type="submit"
      disabled={!enabled || pending}
      className="inline-flex min-w-40 items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
    >
      {pending ? "Restoring catalog…" : "Restore Snapshot"}
    </button>
  );
}

type CompletedRestorePreflight = NonNullable<
  RestorePreflightActionState["result"]
>;

function PreflightComparison({ result }: { result: CompletedRestorePreflight }) {
  const catalogRows = result.catalog
    ? [
        {
          label: "Categories",
          snapshot: result.catalog.categoriesInSnapshot,
          newRecords: result.catalog.categoriesToCreate,
          matched: result.catalog.categoriesToUpdate,
          skipped: result.catalog.destinationCategoriesPreserved,
          conflicts: result.catalog.categoriesConflicting,
        },
        {
          label: "Products",
          snapshot: result.catalog.productsInSnapshot,
          newRecords: result.catalog.productsToCreate,
          matched: result.catalog.productsToMatch,
          skipped: result.catalog.destinationProductsPreserved,
          conflicts: result.catalog.productsConflicting,
        },
      ]
    : [];
  const storeWideGroups = result.selectedGroups.filter(
    (group) => group.scope !== "channel",
  );

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/3">
      <div className="flex flex-col gap-2 border-b border-black/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-white/8">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Snapshot → Destination</h4>
          <p className="mt-0.5 truncate text-[11px] text-black/45 dark:text-white/45">
            {result.snapshotName} v{result.snapshotVersion} → {result.destinationEnvironmentName} · {result.destinationChannelName}
          </p>
        </div>
        <span className={`w-fit rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
          result.canRestore
            ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-200"
            : "bg-red-500/12 text-red-800 dark:text-red-200"
        }`}>
          {result.canRestore ? "Ready" : "Blocked"}
        </span>
      </div>

      {catalogRows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
            <caption className="sr-only">Catalog record comparison between the snapshot and destination</caption>
            <thead className="bg-black/2 text-[10px] uppercase tracking-wide text-black/40 dark:bg-white/3 dark:text-white/40">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Records</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Snapshot</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">New</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Matched</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Skipped</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Conflicting</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/6 dark:divide-white/6">
              {catalogRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-4 py-2.5 font-semibold">{row.label}</th>
                  <td className="px-3 py-2.5 text-right text-black/55 dark:text-white/55">{row.snapshot}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-emerald-700 dark:text-emerald-300">{row.newRecords}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-blue-700 dark:text-blue-300">{row.matched}</td>
                  <td className="px-3 py-2.5 text-right text-black/45 dark:text-white/45">{row.skipped}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold ${row.conflicts > 0 ? "text-red-700 dark:text-red-300" : "text-black/35 dark:text-white/35"}`}>{row.conflicts}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-black/6 px-4 py-2 text-[10px] text-black/40 dark:border-white/6 dark:text-white/40">
            Skipped records exist only in the destination and will be preserved.
          </p>
        </div>
      ) : (
        <p className="px-4 py-3 text-xs text-black/45 dark:text-white/45">Catalog was not selected for this restore.</p>
      )}

      {result.catalog ? (
        <div className="grid grid-cols-2 border-t border-black/8 dark:border-white/8">
          <div className="border-r border-black/8 px-4 py-3 dark:border-white/8">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">Existing assignments</p>
            <p className="mt-1 text-lg font-semibold">{result.catalog.productsAlreadyAssigned}</p>
            <p className="text-[10px] text-black/40 dark:text-white/40">Already on this channel</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">New assignments</p>
            <p className="mt-1 text-lg font-semibold text-emerald-700 dark:text-emerald-300">{result.catalog.channelAssignmentsToAdd}</p>
            <p className="text-[10px] text-black/40 dark:text-white/40">Will be added to this channel</p>
          </div>
        </div>
      ) : null}

      <div className="grid border-t border-black/8 md:grid-cols-2 dark:border-white/8">
        <div className="border-b border-black/8 px-4 py-3 md:border-r md:border-b-0 dark:border-white/8">
          <div className="flex items-center justify-between gap-3">
            <h5 className="text-xs font-semibold">Store-wide changes</h5>
            <span className="text-[10px] text-black/40 dark:text-white/40">{storeWideGroups.length}</span>
          </div>
          {storeWideGroups.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {storeWideGroups.map((group) => (
                <li key={group.id} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="min-w-0 truncate">{group.label}</span>
                  <span className="shrink-0 text-black/40 dark:text-white/40">
                    {group.resourceCount} resources · {group.scope === "mixed" ? "Channel + store" : "Store-wide"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-black/40 dark:text-white/40">None selected.</p>
          )}
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <h5 className="text-xs font-semibold">Manual actions required</h5>
            <span className="text-[10px] text-black/40 dark:text-white/40">{result.manualActions.length}</span>
          </div>
          {result.manualActions.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-4 text-amber-900 dark:text-amber-100">
              {result.manualActions.map((action) => <li key={action}>{action}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-black/40 dark:text-white/40">No manual follow-up identified.</p>
          )}
        </div>
      </div>

      {result.warnings.length > 0 ? (
        <div className="border-t border-amber-500/20 bg-amber-500/7 px-4 py-3 text-[11px] leading-4 text-amber-950 dark:text-amber-100">
          <p className="font-semibold">Warnings ({result.warnings.length})</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">{result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      ) : null}
      {result.blockingIssues.length > 0 ? (
        <div role="alert" className="border-t border-red-500/20 bg-red-500/7 px-4 py-3 text-[11px] leading-4 text-red-950 dark:text-red-100">
          <p className="font-semibold">Conflicts to resolve ({result.blockingIssues.length})</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">{result.blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}

export function SnapshotRestore({
  snapshot,
  destinations,
  snapshotOptions = [],
  initialDestinationEnvironmentId,
  initialDestinationChannelId,
  matchSourceDestination = true,
}: {
  snapshot: {
    id: number;
    ownerUserId: string;
    name: string;
    snapshotVersion: number;
    sourceEnvironmentId: number;
    sourceEnvironmentName: string;
    sourceStoreHash: string;
    sourceChannelId: number;
    sourceChannelName: string;
    categoryCount: number;
    productCount: number;
    variantCount: number;
    imageCount: number;
    metafieldCount: number;
    createdAt: string;
    publishedAt: string | null;
    isFavorite?: boolean;
    availableRestoreGroups: SnapshotRestoreGroup[];
  };
  destinations: CatalogRestoreDestination[];
  snapshotOptions?: Array<{
    id: number;
    ownerUserId: string;
    name: string;
    snapshotVersion: number;
    sourceEnvironmentName: string;
    sourceChannelName: string;
    sourceEnvironmentId: number;
    sourceChannelId: number;
    sourceStoreHash: string;
    categoryCount: number;
    productCount: number;
    variantCount: number;
    imageCount: number;
    metafieldCount: number;
    createdAt: string;
    publishedAt: string | null;
    isFavorite?: boolean;
    availableRestoreGroups: SnapshotRestoreGroup[];
  }>;
  initialDestinationEnvironmentId?: number;
  initialDestinationChannelId?: number;
  matchSourceDestination?: boolean;
  stepNames?: string[];
}) {
  const router = useRouter();
  const isChannelSurface = initialDestinationEnvironmentId !== undefined && initialDestinationChannelId !== undefined;
  const isActionInProgress = useCatalogOperationActive(
    isChannelSurface
      ? { environmentId: initialDestinationEnvironmentId, channelId: initialDestinationChannelId }
      : { snapshotId: snapshot.id },
  );
  const orderedSnapshotOptions = [...snapshotOptions].sort((left, right) => {
    const favoriteOrder = Number(Boolean(right.isFavorite)) - Number(Boolean(left.isFavorite));
    if (favoriteOrder !== 0) return favoriteOrder;
    const nameOrder = snapshotNameCollator.compare(left.name, right.name);
    return nameOrder || right.snapshotVersion - left.snapshotVersion || right.id - left.id;
  });
  const selectableSnapshots = orderedSnapshotOptions.length > 0
    ? orderedSnapshotOptions
    : [snapshot];
  const [selectedSnapshotId, setSelectedSnapshotId] = useState(snapshot.id.toString());
  const activeSnapshot = selectableSnapshots.find(
    (candidate) => candidate.id.toString() === selectedSnapshotId,
  ) ?? snapshot;
  const snapshotSeries = selectableSnapshots.reduce<Array<{
    key: string;
    name: string;
    sourceEnvironmentName: string;
    sourceChannelName: string;
    isFavorite: boolean;
    versions: typeof selectableSnapshots;
  }>>((series, option) => {
    const key = getSnapshotSeriesKey(option);
    const existing = series.find((candidate) => candidate.key === key);
    if (existing) {
      existing.versions.push(option);
    } else {
      series.push({
        key,
        name: option.name,
        sourceEnvironmentName: option.sourceEnvironmentName,
        sourceChannelName: option.sourceChannelName,
        isFavorite: Boolean(option.isFavorite),
        versions: [option],
      });
    }
    return series;
  }, []);
  const selectedSeriesKey = getSnapshotSeriesKey(activeSnapshot);
  const selectedSeriesVersions = snapshotSeries.find(
    (series) => series.key === selectedSeriesKey,
  )?.versions ?? [activeSnapshot];
  const availableGroupDefinitions = SNAPSHOT_RESTORE_GROUPS.filter((group) =>
    isSnapshotRestoreGroupRestorable(group.id) &&
    activeSnapshot.availableRestoreGroups.includes(group.id),
  );
  const readyDestinations = useMemo(
    () => destinations.filter((destination) => destination.channels.length > 0),
    [destinations],
  );
  const initialEnvironment =
    readyDestinations.find((destination) =>
      destination.id === initialDestinationEnvironmentId,
    ) ?? (matchSourceDestination ? readyDestinations.find(
      (destination) => destination.id === activeSnapshot.sourceEnvironmentId,
    ) : undefined) ?? readyDestinations[0];
  const initialChannel =
    initialEnvironment?.channels.find((channel) =>
      channel.id === initialDestinationChannelId,
    ) ?? (matchSourceDestination ? initialEnvironment?.channels.find(
      (channel) => channel.id === activeSnapshot.sourceChannelId,
    ) : undefined) ?? initialEnvironment?.channels[0];
  const [isOpen, setIsOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<RestoreWizardStep>(1);
  const [environmentId, setEnvironmentId] = useState(
    initialEnvironment?.id.toString() ?? "",
  );
  const [channelId, setChannelId] = useState(
    initialChannel?.id.toString() ?? "",
  );
  const [confirmation, setConfirmation] = useState("");
  const defaultRestoreGroups = defaultGroupsForSnapshot(
    activeSnapshot.availableRestoreGroups,
  );
  const [restoreGroups, setRestoreGroups] = useState<SnapshotRestoreGroup[]>(
    defaultRestoreGroups,
  );
  const [showActionFeedback, setShowActionFeedback] = useState(false);
  const [state, formAction, restorePending] = useActionState(
    restoreSnapshot,
    initialState,
  );
  const [preflightState, preflightAction, preflightPending] = useActionState(
    preflightSnapshotRestore,
    initialPreflightState,
  );
  const modalRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stepHeadingRef = useRef<HTMLElement>(null);
  const selectedEnvironment = destinations.find(
    (destination) => destination.id.toString() === environmentId,
  );
  const selectedChannel = selectedEnvironment?.channels.find(
    (channel) => channel.id.toString() === channelId,
  );
  const isSameStore =
    selectedEnvironment?.storeHash === activeSnapshot.sourceStoreHash;
  const isSameChannel =
    isSameStore && selectedChannel?.id === activeSnapshot.sourceChannelId;
  const normalizedRestoreGroups = [...restoreGroups].sort();
  const preflightMatchesCurrentSelection =
    preflightState.snapshotId === activeSnapshot.id &&
    preflightState.destinationEnvironmentId === Number(environmentId) &&
    preflightState.destinationChannelId === Number(channelId) &&
    preflightState.restoreGroups.length === normalizedRestoreGroups.length &&
    [...preflightState.restoreGroups].sort().every(
      (group, index) => group === normalizedRestoreGroups[index],
    );
  const currentPreflight = preflightMatchesCurrentSelection
    ? preflightState.result
    : null;
  const preflightPassed = Boolean(currentPreflight?.canRestore);

  function selectSnapshotVersion(nextSnapshotId: string) {
    const nextSnapshot = selectableSnapshots.find(
      (candidate) => candidate.id.toString() === nextSnapshotId,
    );
    if (!nextSnapshot) return;
    setSelectedSnapshotId(nextSnapshotId);
    setRestoreGroups(defaultGroupsForSnapshot(nextSnapshot.availableRestoreGroups));
    setConfirmation("");
  }

  function openRestoreModal() {
    setShowActionFeedback(false);
    setConfirmation("");
    setRestoreGroups(defaultRestoreGroups);
    setWizardStep(1);
    setIsOpen(true);
  }

  useEffect(() => {
    if (state.status === "success") {
      if (state.operationId) {
        startCatalogOperation({ kind: "restore", snapshotId: activeSnapshot.id, environmentId: Number(environmentId), channelId: Number(channelId), operationId: state.operationId });
      }
      queueMicrotask(() => {
        setShowActionFeedback(true);
        setIsOpen(false);
      });
      router.refresh();
    } else if (state.status === "error") {
      finishCatalogOperation();
      queueMicrotask(() => {
        setShowActionFeedback(true);
        setWizardStep(3);
        setIsOpen(true);
      });
    }
  }, [activeSnapshot.id, channelId, environmentId, router, state.operationId, state.status]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable?.[0];
      const last = focusable?.[focusable.length - 1];

      if (event.shiftKey && first && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && last && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    stepHeadingRef.current?.focus();
  }, [isOpen, wizardStep]);

  return (
    <>
      <button
        type="button"
        onClick={openRestoreModal}
        disabled={readyDestinations.length === 0 || isActionInProgress}
        title={
          readyDestinations.length === 0
            ? "Add a reachable BigCommerce environment and channel first."
            : undefined
        }
        className="inline-flex h-6 items-center justify-center gap-1 rounded-md bg-emerald-600 px-2.5 text-[10px] leading-none font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
      >
        <RestoreIcon />
        Restore Snapshot
      </button>

      {isOpen ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
        >
          <section
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-snapshot-title"
            aria-describedby="restore-snapshot-description"
            className="flex max-h-[min(54rem,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/12 bg-white shadow-2xl dark:bg-neutral-950"
          >
            <header className="border-b border-black/8 px-6 pt-6 pb-4 sm:px-7 sm:pt-7 dark:border-white/8">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    Catalog restoration
                  </p>
                  <h2
                    id="restore-snapshot-title"
                    className="mt-1 break-words text-2xl font-semibold tracking-[-0.03em]"
                  >
                    Restore {activeSnapshot.name}
                  </h2>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  aria-label="Close restore wizard"
                  disabled={preflightPending || restorePending}
                  onClick={() => setIsOpen(false)}
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-black/10 text-lg text-black/45 transition hover:bg-black/5 hover:text-black disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
                >
                  ×
                </button>
              </div>

              <p
                id="restore-snapshot-description"
                className="mt-2 text-sm leading-6 text-black/55 dark:text-white/55"
              >
                Choose the destination, select the sections to restore, then review a read-only preflight before confirming.
              </p>

              <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Restore progress">
                {restoreWizardSteps.map((step) => {
                  const isCurrent = wizardStep === step.id;
                  const isComplete = wizardStep > step.id;
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        disabled={!isComplete || preflightPending || restorePending}
                        onClick={() => setWizardStep(step.id)}
                        aria-current={isCurrent ? "step" : undefined}
                        className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] font-semibold transition sm:px-3 ${
                          isCurrent
                            ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-200"
                            : isComplete
                              ? "text-emerald-700 hover:bg-emerald-500/8 disabled:opacity-100 dark:text-emerald-300"
                              : "text-black/35 dark:text-white/35"
                        }`}
                      >
                        <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] ${
                          isCurrent || isComplete
                            ? "bg-emerald-600 text-white"
                            : "bg-black/8 text-black/45 dark:bg-white/10 dark:text-white/45"
                        }`}>
                          {isComplete ? "✓" : step.id}
                        </span>
                        <span className="hidden truncate sm:block">{step.label}</span>
                        <span className="sm:hidden">Step {step.id}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </header>

            <form action={formAction} className="flex min-h-0 flex-1 flex-col">
              <input type="hidden" name="snapshotId" value={activeSnapshot.id} />
              <input type="hidden" name="destinationEnvironmentId" value={environmentId} />
              <input type="hidden" name="destinationChannelId" value={channelId} />
              {restoreGroups.map((group) => (
                <input key={group} type="hidden" name="restoreGroups" value={group} />
              ))}

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
                {wizardStep === 1 ? (
                  <div>
                    <h3
                      ref={(node) => { stepHeadingRef.current = node; }}
                      tabIndex={-1}
                      className="text-lg font-semibold outline-none"
                    >
                      Choose a destination
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-black/45 dark:text-white/45">
                      Store-specific IDs are remapped using category paths, product SKUs, and product slugs.
                    </p>

                    {snapshotOptions.length > 0 ? (
                      <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/7 p-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                              Snapshot
                            </span>
                            <select
                              id="restore-snapshot-series"
                              value={selectedSeriesKey}
                              onChange={(event) => {
                                const nextSeries = snapshotSeries.find(
                                  (series) => series.key === event.target.value,
                                );
                                const newestVersion = nextSeries?.versions[0];
                                if (newestVersion) selectSnapshotVersion(newestVersion.id.toString());
                              }}
                              className="mt-2 w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-white/12 dark:bg-neutral-900"
                            >
                              {snapshotSeries.map((series) => (
                                <option key={series.key} value={series.key}>
                                  {series.isFavorite ? "⭐ " : ""}{series.name} · {series.sourceChannelName}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                              Version
                            </span>
                            <select
                              id="restore-snapshot-version"
                              value={selectedSnapshotId}
                              onChange={(event) => selectSnapshotVersion(event.target.value)}
                              className="mt-2 w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-white/12 dark:bg-neutral-900"
                            >
                              {selectedSeriesVersions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.publishedAt ? "🌐 " : ""}Version {option.snapshotVersion}{option.publishedAt ? " · Published" : ""} · {dateFormatter.format(new Date(option.createdAt))}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <p className="mt-2 text-[11px] text-black/40 dark:text-white/40">
                          {activeSnapshot.sourceEnvironmentName} · {activeSnapshot.sourceChannelName}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <article className="rounded-2xl border border-black/8 bg-black/2.5 p-4 dark:border-white/8 dark:bg-white/3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-black/35 dark:text-white/35">
                          Snapshot source
                        </p>
                        <h4 className="mt-2 font-semibold">{activeSnapshot.sourceEnvironmentName}</h4>
                        <p className="mt-1 text-sm text-black/55 dark:text-white/55">{activeSnapshot.sourceChannelName}</p>
                        <dl className="mt-3 space-y-1 text-xs text-black/40 dark:text-white/40">
                          <div className="flex justify-between gap-3"><dt>Version</dt><dd>{activeSnapshot.snapshotVersion}</dd></div>
                          <div className="flex justify-between gap-3"><dt>Captured</dt><dd><time dateTime={activeSnapshot.createdAt}>{dateFormatter.format(new Date(activeSnapshot.createdAt))}</time></dd></div>
                          <div className="flex justify-between gap-3"><dt>Catalog</dt><dd>{activeSnapshot.categoryCount} categories · {activeSnapshot.productCount} products</dd></div>
                          <div className="flex justify-between gap-3"><dt>Children</dt><dd>{activeSnapshot.variantCount} variants · {activeSnapshot.imageCount} images</dd></div>
                        </dl>
                      </article>

                      <article className="rounded-2xl border border-emerald-500/20 bg-emerald-500/7 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">Destination</p>
                        <label className="mt-3 block text-xs font-medium" htmlFor="restore-environment">Environment</label>
                        <select
                          id="restore-environment"
                          value={environmentId}
                          onChange={(event) => {
                            const nextEnvironmentId = event.target.value;
                            const nextEnvironment = destinations.find(
                              (destination) => destination.id.toString() === nextEnvironmentId,
                            );
                            setEnvironmentId(nextEnvironmentId);
                            setChannelId(nextEnvironment?.channels[0]?.id.toString() ?? "");
                            setConfirmation("");
                          }}
                          className="mt-1.5 w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-white/12 dark:bg-neutral-900"
                        >
                          {destinations.map((destination) => (
                            <option key={destination.id} value={destination.id} disabled={destination.channels.length === 0}>
                              {destination.isFavorite ? "⭐ " : ""}{destination.name}{destination.error ? " — unavailable" : ""}
                            </option>
                          ))}
                        </select>

                        <label className="mt-3 block text-xs font-medium" htmlFor="restore-channel">Channel</label>
                        <select
                          id="restore-channel"
                          value={channelId}
                          onChange={(event) => {
                            setChannelId(event.target.value);
                            setConfirmation("");
                          }}
                          className="mt-1.5 w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-white/12 dark:bg-neutral-900"
                        >
                          {selectedEnvironment?.channels.map((channel) => (
                            <option key={channel.id} value={channel.id}>
                              {channel.isFavorite ? "⭐ " : ""}{channel.name}
                            </option>
                          ))}
                        </select>

                        <p className="mt-3 text-xs leading-5 text-black/45 dark:text-white/45">
                          {isSameChannel
                            ? "This is the snapshot’s original channel."
                            : isSameStore
                              ? "Different channel in the snapshot’s original store."
                              : "Different store: brands, tax classes, categories, products, and variants will be remapped."}
                        </p>
                      </article>
                    </div>
                  </div>
                ) : null}

                {wizardStep === 2 ? (
                  <fieldset>
                    <legend
                      ref={(node) => { stepHeadingRef.current = node; }}
                      tabIndex={-1}
                      className="text-lg font-semibold outline-none"
                    >
                      Choose what to restore
                    </legend>
                    <p className="mt-1 text-xs leading-5 text-black/45 dark:text-white/45">
                      Only sections present in this version are shown. Catalog is selected by default; configuration is opt-in.
                    </p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {availableGroupDefinitions.map((group) => {
                        const checked = restoreGroups.includes(group.id);
                        const isStoreWide = group.scope === "store";
                        return (
                          <label
                            key={group.id}
                            className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                              checked
                                ? "border-emerald-500/45 bg-emerald-500/8"
                                : "border-black/10 bg-black/2 hover:border-emerald-500/25 dark:border-white/10 dark:bg-white/3"
                            }`}
                          >
                            <input
                              type="checkbox"
                              value={group.id}
                              checked={checked}
                              onChange={(event) => {
                                setRestoreGroups((current) =>
                                  event.target.checked
                                    ? [...new Set([...current, group.id])]
                                    : current.filter((value) => value !== group.id),
                                );
                                setConfirmation("");
                              }}
                              className="mt-0.5 size-4 accent-emerald-600"
                            />
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                                {group.label}
                                {isStoreWide ? (
                                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-800 dark:text-amber-200">Store-wide</span>
                                ) : null}
                              </span>
                              <span className="mt-1 block text-[11px] leading-4 text-black/45 dark:text-white/45">{group.description}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {restoreGroups.some((group) => group === "shipping" || group === "tax" || group === "inventory" || group === "b2b") ? (
                      <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] leading-4 text-amber-900 dark:text-amber-100">
                        Shipping, tax, inventory, and B2B data are store-wide. Restore is additive, but creating B2B Companies or users may trigger BigCommerce account or welcome email.
                      </p>
                    ) : null}
                    {restoreGroups.length === 0 ? (
                      <p role="alert" className="mt-3 text-xs font-medium text-red-700 dark:text-red-300">Select at least one section to continue.</p>
                    ) : null}
                  </fieldset>
                ) : null}

                {wizardStep === 3 ? (
                  <div>
                    <h3
                      ref={(node) => { stepHeadingRef.current = node; }}
                      tabIndex={-1}
                      className="text-lg font-semibold outline-none"
                    >
                      Review and confirm
                    </h3>
                    <div className="mt-3 rounded-2xl border border-black/8 bg-black/2.5 p-4 text-xs dark:border-white/8 dark:bg-white/3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><p className="text-black/40 dark:text-white/40">Snapshot</p><p className="mt-1 font-semibold">{activeSnapshot.name} · Version {activeSnapshot.snapshotVersion}</p></div>
                        <div><p className="text-black/40 dark:text-white/40">Destination</p><p className="mt-1 font-semibold">{selectedEnvironment?.name} · {selectedChannel?.name}</p></div>
                      </div>
                      <p className="mt-3 text-black/40 dark:text-white/40">Selected sections</p>
                      <p className="mt-1 font-medium">{availableGroupDefinitions.filter((group) => restoreGroups.includes(group.id)).map((group) => group.label).join(", ")}</p>
                    </div>

                    <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/6 p-4">
                      <h4 className="text-sm font-semibold text-red-800 dark:text-red-200">This changes the destination</h4>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-red-900/70 dark:text-red-100/70">
                        <li>Existing matched products keep their attributes and are assigned to the selected channel and snapshot categories.</li>
                        <li>Missing products are created with their variants, images, metadata, category links, and stock.</li>
                        <li>Records absent from the snapshot are preserved; BigCommerce cannot wrap the restore in one transaction.</li>
                      </ul>
                    </div>

                    {preflightPending ? (
                      <div role="status" aria-live="polite" className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-5 text-center text-sm text-emerald-900 dark:text-emerald-100">
                        <span className="mx-auto block size-6 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />
                        <p className="mt-3 font-semibold">Running destination preflight…</p>
                        <p className="mt-1 text-xs opacity-70">Checking catalog matches, resources, warnings, and store-wide impact.</p>
                      </div>
                    ) : preflightMatchesCurrentSelection && currentPreflight ? (
                      <>
                        <p className="mt-4 text-xs font-medium" aria-live="polite">{preflightState.message}</p>
                        <PreflightComparison result={currentPreflight} />
                      </>
                    ) : preflightMatchesCurrentSelection && preflightState.message ? (
                      <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-xs text-red-900 dark:text-red-100">
                        {preflightState.message}
                      </p>
                    ) : (
                      <p className="mt-4 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
                        Run preflight again before restoring this selection.
                      </p>
                    )}

                    {showActionFeedback && state.status === "error" ? (
                      <div role="alert" className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/8 p-4 text-sm text-red-800 dark:text-red-200">{state.message}</div>
                    ) : null}

                    {preflightPassed ? (
                      <div className="mt-4">
                        <label htmlFor="restore-confirmation" className="text-sm font-medium">Type <span className="font-mono">RESTORE</span> to confirm</label>
                        <input
                          id="restore-confirmation"
                          name="confirmation"
                          autoComplete="off"
                          value={confirmation}
                          onChange={(event) => setConfirmation(event.target.value)}
                          className="mt-2 w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 font-mono text-sm outline-none focus:border-red-500 dark:border-white/12 dark:bg-neutral-900"
                        />
                      </div>
                    ) : <input type="hidden" name="confirmation" value="" />}
                  </div>
                ) : null}
              </div>

              <footer className="flex shrink-0 flex-col-reverse gap-3 border-t border-black/8 bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7 dark:border-white/8 dark:bg-neutral-950">
                <button
                  type="button"
                  disabled={preflightPending || restorePending}
                  onClick={() => setIsOpen(false)}
                  className="inline-flex items-center justify-center rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-black/4 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:hover:bg-white/6"
                >
                  Cancel
                </button>
                <div className="flex gap-2 sm:justify-end">
                  {wizardStep > 1 ? (
                    <button
                      type="button"
                      disabled={preflightPending || restorePending}
                      onClick={() => {
                        setConfirmation("");
                        setWizardStep((wizardStep - 1) as RestoreWizardStep);
                      }}
                      className="inline-flex flex-1 items-center justify-center rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-black/4 disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none dark:border-white/10 dark:hover:bg-white/6"
                    >
                      Back
                    </button>
                  ) : null}
                  {wizardStep === 1 ? (
                    <button
                      type="button"
                      disabled={!selectedEnvironment || !selectedChannel}
                      onClick={() => setWizardStep(2)}
                      className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45 sm:min-w-32 sm:flex-none"
                    >
                      Continue
                    </button>
                  ) : null}
                  {wizardStep === 2 ? (
                    <button
                      type="submit"
                      formAction={preflightAction}
                      disabled={restoreGroups.length === 0 || preflightPending}
                      aria-busy={preflightPending}
                      onClick={() => {
                        setConfirmation("");
                        setWizardStep(3);
                      }}
                      className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45 sm:min-w-44 sm:flex-none"
                    >
                      Continue
                    </button>
                  ) : null}
                  {wizardStep === 3 && (!preflightPassed || preflightPending) ? (
                    <button
                      type="submit"
                      formAction={preflightAction}
                      disabled={preflightPending || restoreGroups.length === 0}
                      aria-busy={preflightPending}
                      className="inline-flex flex-1 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45 sm:min-w-44 sm:flex-none"
                    >
                      {preflightPending ? (
                        <><span className="mr-2 size-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" />Running preflight…</>
                      ) : "Run preflight again"}
                    </button>
                  ) : null}
                  {wizardStep === 3 && preflightPassed && !preflightPending ? (
                    <RestoreSubmitButton
                      pending={restorePending}
                      enabled={confirmation === "RESTORE" && Boolean(selectedEnvironment && selectedChannel)}
                    />
                  ) : null}
                </div>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
