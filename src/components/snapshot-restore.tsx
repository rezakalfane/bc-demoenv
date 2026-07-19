"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
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

function RestoreSubmitButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();

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
    availableRestoreGroups: SnapshotRestoreGroup[];
  };
  destinations: CatalogRestoreDestination[];
  snapshotOptions?: Array<{
    id: number;
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
    createdAt: string;
    publishedAt: string | null;
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
  const [environmentId, setEnvironmentId] = useState(
    initialEnvironment?.id.toString() ?? "",
  );
  const [channelId, setChannelId] = useState(
    initialChannel?.id.toString() ?? "",
  );
  const [confirmation, setConfirmation] = useState("");
  const defaultRestoreGroups = SNAPSHOT_RESTORE_GROUPS.filter(
    (group) =>
      group.defaultChecked &&
      isSnapshotRestoreGroupRestorable(group.id) &&
      activeSnapshot.availableRestoreGroups.includes(group.id),
  ).map((group) => group.id);
  const [restoreGroups, setRestoreGroups] = useState<SnapshotRestoreGroup[]>(
    defaultRestoreGroups,
  );
  const [showActionFeedback, setShowActionFeedback] = useState(false);
  const [state, formAction] = useActionState(restoreSnapshot, initialState);
  const [preflightState, preflightAction, preflightPending] = useActionState(
    preflightSnapshotRestore,
    initialPreflightState,
  );
  const modalRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
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

  function openRestoreModal() {
    setShowActionFeedback(false);
    setConfirmation("");
    setRestoreGroups(defaultRestoreGroups);
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
        className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] leading-none font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
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
            className="flex max-h-[min(54rem,calc(100vh-2rem))] w-full max-w-3xl flex-col rounded-3xl border border-white/12 bg-white p-6 shadow-2xl sm:p-7 dark:bg-neutral-950"
          >
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
                aria-label="Close restore confirmation"
                onClick={() => setIsOpen(false)}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-black/10 text-lg text-black/45 transition hover:bg-black/5 hover:text-black dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
              >
                ×
              </button>
            </div>

            <p
              id="restore-snapshot-description"
              className="mt-3 text-sm leading-6 text-black/55 dark:text-white/55"
            >
              Choose any saved environment and active channel. Store-specific IDs
              are remapped while stable category slugs, product SKUs, and product
              slugs are used to find existing catalog records.
            </p>

            <div className="mt-5 min-h-0 overflow-y-auto pr-1">
              {snapshotOptions.length > 0 ? (
                <div className="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/7 p-4">
                  <label htmlFor="restore-snapshot-version" className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                    Snapshot version
                  </label>
                  <select
                    id="restore-snapshot-version"
                    value={selectedSnapshotId}
                    onChange={(event) => {
                      const nextSnapshotId = event.target.value;
                      const nextSnapshot = selectableSnapshots.find(
                        (candidate) => candidate.id.toString() === nextSnapshotId,
                      );
                      setSelectedSnapshotId(nextSnapshotId);
                      setRestoreGroups((current) => current.filter((group) =>
                        isSnapshotRestoreGroupRestorable(group) &&
                        nextSnapshot?.availableRestoreGroups.includes(group),
                      ));
                      setConfirmation("");
                    }}
                    className="mt-2 w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-500 dark:border-white/12 dark:bg-neutral-900"
                  >
                    {orderedSnapshotOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.publishedAt ? "★ " : ""}{option.name} · Version {option.snapshotVersion}{option.publishedAt ? " · Published" : ""} · {option.sourceChannelName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <article className="rounded-2xl border border-black/8 bg-black/2.5 p-4 dark:border-white/8 dark:bg-white/3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-black/35 dark:text-white/35">
                    Snapshot source
                  </p>
                  <h3 className="mt-2 font-semibold">
                    {activeSnapshot.sourceEnvironmentName}
                  </h3>
                  <p className="mt-1 text-sm text-black/55 dark:text-white/55">
                    {activeSnapshot.sourceChannelName}
                  </p>
                  <dl className="mt-3 space-y-1 text-xs text-black/40 dark:text-white/40">
                    <div className="flex justify-between gap-3">
                      <dt>Version</dt><dd>{activeSnapshot.snapshotVersion}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Captured</dt>
                      <dd><time dateTime={activeSnapshot.createdAt}>{dateFormatter.format(new Date(activeSnapshot.createdAt))}</time></dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Catalog</dt>
                      <dd>{activeSnapshot.categoryCount} categories · {activeSnapshot.productCount} products</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Children</dt>
                      <dd>{activeSnapshot.variantCount} variants · {activeSnapshot.imageCount} images</dd>
                    </div>
                  </dl>
                </article>

                <article className="rounded-2xl border border-emerald-500/20 bg-emerald-500/7 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                    Destination
                  </p>
                  <label className="mt-3 block text-xs font-medium" htmlFor="restore-environment">
                    Environment
                  </label>
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
                      <option
                        key={destination.id}
                        value={destination.id}
                        disabled={destination.channels.length === 0}
                      >
                        {destination.name}{destination.error ? " — unavailable" : ""}
                      </option>
                    ))}
                  </select>

                  <label className="mt-3 block text-xs font-medium" htmlFor="restore-channel">
                    Channel
                  </label>
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
                        {channel.name}
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

              <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/6 p-4 text-sm">
                <h3 className="font-semibold text-red-800 dark:text-red-200">
                  This changes the destination catalog
                </h3>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-5 text-red-900/70 dark:text-red-100/70">
                  <li>Categories are created or updated by slug and hierarchy; existing destination categories are never deleted.</li>
                  <li>Products are updated by SKU or slug, or created. Their variants, images, custom fields, pricing rules, videos, modifiers, metafields, and category links are synchronized.</li>
                  <li>Products, variants, and channel assignments absent from the snapshot are preserved.</li>
                  <li>BigCommerce cannot wrap this work in one transaction. A failed request can leave a partially restored catalog; rerunning the same snapshot safely continues reconciliation.</li>
                </ul>
              </div>

              {showActionFeedback && state.status === "success" && state.result ? (
                <div role="status" className="mt-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-4 text-sm text-emerald-900 dark:text-emerald-100">
                  <p className="font-semibold">{state.message}</p>
                  <p className="mt-1 text-xs leading-5 opacity-75">
                    {state.result.categoriesCreated} categories created, {state.result.categoriesUpdated} updated · {state.result.productsCreated} products created, {state.result.productsUpdated} updated · existing categories, products, variants, and assignments preserved.
                  </p>
                </div>
              ) : null}

              {showActionFeedback && state.status === "error" ? (
                <div role="alert" className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/8 p-4 text-sm text-red-800 dark:text-red-200">
                  {state.message}
                </div>
              ) : null}

              {!(showActionFeedback && state.status === "success") ? (
                <form action={formAction} className="mt-5">
                  <input type="hidden" name="snapshotId" value={activeSnapshot.id} />
                  <input type="hidden" name="destinationEnvironmentId" value={environmentId} />
                  <input type="hidden" name="destinationChannelId" value={channelId} />
                  <fieldset>
                    <legend className="text-sm font-semibold">Choose what to restore</legend>
                    <p className="mt-1 text-xs leading-5 text-black/45 dark:text-white/45">
                      Only sections present in this snapshot version are shown. Catalog is selected by default; configuration is opt-in.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                              name="restoreGroups"
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
                                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-800 dark:text-amber-200">
                                    Store-wide
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-1 block text-[11px] leading-4 text-black/45 dark:text-white/45">
                                {group.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {restoreGroups.some((group) => group === "shipping" || group === "tax" || group === "inventory" || group === "b2b") ? (
                      <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-4 text-amber-900 dark:text-amber-100">
                        Shipping, tax, inventory, and B2B data are shared by the destination store. Portable settings and B2B demo records are restored additively; mapping-sensitive or read-only records remain captured with warnings. Creating B2B Companies or users may trigger BigCommerce account or welcome email.
                      </p>
                    ) : null}
                  </fieldset>
                  <div className="my-4 border-t border-black/8 dark:border-white/8" />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Destination preflight</h3>
                      <p className="mt-1 text-xs leading-5 text-black/45 dark:text-white/45">
                        Checks catalog matches, selected resources, warnings, and store-wide impact without changing BigCommerce.
                      </p>
                    </div>
                    <button
                      type="submit"
                      formAction={preflightAction}
                      disabled={preflightPending}
                      aria-busy={preflightPending}
                      className="inline-flex items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-500/14 disabled:cursor-not-allowed disabled:opacity-45 dark:text-emerald-200"
                    >
                      {preflightPending ? (
                        <>
                          <span
                            className="mr-2 size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
                            aria-hidden="true"
                          />
                          Running preflight…
                        </>
                      ) : (
                        "Run restore preflight"
                      )}
                    </button>
                  </div>

                  {preflightMatchesCurrentSelection && preflightState.message ? (
                    <div className={`mt-3 rounded-xl border p-3 text-xs leading-5 ${
                      preflightPassed
                        ? "border-emerald-500/25 bg-emerald-500/8 text-emerald-900 dark:text-emerald-100"
                        : "border-red-500/25 bg-red-500/8 text-red-900 dark:text-red-100"
                    }`} role={preflightPassed ? "status" : "alert"}>
                      <p className="font-semibold">{preflightState.message}</p>
                      {currentPreflight?.catalog ? (
                        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                          <div><dt className="text-black/45 dark:text-white/45">Categories created</dt><dd className="font-semibold">{currentPreflight.catalog.categoriesToCreate}</dd></div>
                          <div><dt className="text-black/45 dark:text-white/45">Categories matched</dt><dd className="font-semibold">{currentPreflight.catalog.categoriesToUpdate}</dd></div>
                          <div><dt className="text-black/45 dark:text-white/45">Products created</dt><dd className="font-semibold">{currentPreflight.catalog.productsToCreate}</dd></div>
                          <div><dt className="text-black/45 dark:text-white/45">Products matched</dt><dd className="font-semibold">{currentPreflight.catalog.productsToMatch}</dd></div>
                          <div><dt className="text-black/45 dark:text-white/45">Assignments added</dt><dd className="font-semibold">{currentPreflight.catalog.channelAssignmentsToAdd}</dd></div>
                          <div><dt className="text-black/45 dark:text-white/45">Already assigned</dt><dd className="font-semibold">{currentPreflight.catalog.productsAlreadyAssigned}</dd></div>
                        </dl>
                      ) : null}
                      {currentPreflight?.selectedGroups.length ? (
                        <p className="mt-2">
                          Sections: {currentPreflight.selectedGroups.map((group) => `${group.label} (${group.resourceCount})`).join(", ")}
                        </p>
                      ) : null}
                      {currentPreflight?.warnings.length ? (
                        <ul className="mt-2 list-disc space-y-1 pl-4">
                          {currentPreflight.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                        </ul>
                      ) : null}
                      {currentPreflight?.manualActions.length ? (
                        <ul className="mt-2 list-disc space-y-1 pl-4">
                          {currentPreflight.manualActions.map((action) => <li key={action}>{action}</li>)}
                        </ul>
                      ) : null}
                      {currentPreflight?.blockingIssues.length ? (
                        <ul className="mt-2 list-disc space-y-1 pl-4">
                          {currentPreflight.blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}
                        </ul>
                      ) : null}
                    </div>
                  ) : preflightState.status !== "idle" ? (
                    <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
                      The restore selection changed. Run preflight again.
                    </p>
                  ) : null}

                  {preflightPassed ? (
                    <div className="mt-4">
                      <label htmlFor="restore-confirmation" className="text-sm font-medium">
                        Type <span className="font-mono">RESTORE</span> to confirm
                      </label>
                      <input
                        id="restore-confirmation"
                        name="confirmation"
                        autoComplete="off"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                        className="mt-2 w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 font-mono text-sm outline-none focus:border-red-500 dark:border-white/12 dark:bg-neutral-900"
                      />
                    </div>
                  ) : (
                    <input type="hidden" name="confirmation" value="" />
                  )}
                  <div className="mt-5 flex flex-col-reverse gap-3 border-t border-black/8 pt-5 sm:flex-row sm:justify-end dark:border-white/8">
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="inline-flex items-center justify-center rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-black/4 dark:border-white/10 dark:hover:bg-white/6"
                    >
                      Cancel
                    </button>
                    <RestoreSubmitButton
                      enabled={
                        preflightPassed &&
                        confirmation === "RESTORE" &&
                        restoreGroups.length > 0 &&
                        Boolean(selectedEnvironment && selectedChannel)
                      }
                    />
                  </div>
                </form>
              ) : (
                <div className="mt-5 flex justify-end border-t border-black/8 pt-5 dark:border-white/8">
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="inline-flex items-center justify-center rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-emerald-300"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
