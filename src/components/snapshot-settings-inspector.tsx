"use client";

import { useEffect, useRef, useState } from "react";
import { InspectIcon } from "@/components/action-icons";
import {
  SNAPSHOT_RESTORE_GROUPS,
  type CapturedConfigurationResource,
  type CapturedSnapshotConfiguration,
} from "@/lib/snapshot-configuration";

type InspectorState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; configuration: CapturedSnapshotConfiguration | null }
  | { status: "error"; message: string };

const configurationGroups = SNAPSHOT_RESTORE_GROUPS.filter(
  (group) => group.id !== "catalog",
);

const scopeLabels = {
  channel: "Channel",
  site: "Site",
  store: "Store-wide",
} as const;

function resourceHasData(resource: CapturedConfigurationResource) {
  if (Array.isArray(resource.data)) return resource.data.length > 0;
  if (resource.data && typeof resource.data === "object") {
    return Object.keys(resource.data).length > 0;
  }
  return resource.data !== null && resource.data !== undefined && resource.data !== "";
}

function formatResourceData(data: unknown) {
  if (data === undefined) return "No data captured.";
  return JSON.stringify(data, null, 2) ?? String(data);
}

export function SnapshotSettingsInspector({
  snapshotId,
  snapshotName,
}: {
  snapshotId: number;
  snapshotName: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<InspectorState>({ status: "idle" });
  const modalRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const loadedConfiguration = state.status === "loaded"
    ? state.configuration
    : null;

  async function openInspector() {
    setIsOpen(true);
    if (state.status !== "idle" && state.status !== "error") return;

    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/snapshots/${snapshotId}/configuration`, {
        cache: "no-store",
      });
      const result = await response.json() as {
        configuration?: CapturedSnapshotConfiguration | null;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error || "Captured settings could not be loaded.");
      setState({ status: "loaded", configuration: result.configuration ?? null });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Captured settings could not be loaded.",
      });
    }
  }

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
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

  const resourceCounts = loadedConfiguration
    ? Object.values(loadedConfiguration).reduce(
        (counts, group) => {
          for (const resource of Object.values(group?.resources ?? {})) {
            if (resource.warning) counts.warnings += 1;
            if (resourceHasData(resource)) counts.captured += 1;
          }
          return counts;
        },
        { captured: 0, warnings: 0 },
      )
    : null;
  const hasCapturedResources = loadedConfiguration
    ? Object.values(loadedConfiguration).some(
        (group) => Object.keys(group?.resources ?? {}).length > 0,
      )
    : false;

  return (
    <>
      <button
        type="button"
        onClick={openInspector}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-black/10 bg-white/60 px-3 py-1.5 text-[11px] leading-none font-semibold transition hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
      >
        <InspectIcon />
        Inspect settings
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
            aria-labelledby="snapshot-settings-title"
            aria-describedby="snapshot-settings-description"
            className="flex max-h-[min(52rem,calc(100vh-2rem))] w-full max-w-4xl flex-col rounded-3xl border border-white/12 bg-white p-6 shadow-2xl sm:p-7 dark:bg-neutral-950"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Captured configuration
                </p>
                <h2 id="snapshot-settings-title" className="mt-1 truncate text-2xl font-semibold tracking-[-0.03em]">
                  Settings in {snapshotName}
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close captured settings"
                onClick={() => setIsOpen(false)}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-black/10 text-lg text-black/45 transition hover:bg-black/5 hover:text-black dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
              >
                ×
              </button>
            </div>

            <div id="snapshot-settings-description" className="mt-3 flex flex-wrap items-center gap-2 text-sm leading-6 text-black/55 dark:text-white/55">
              <p>Inspect the immutable BigCommerce configuration stored with this version.</p>
              {resourceCounts ? (
                <>
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                    {resourceCounts.captured} resources captured
                  </span>
                  {resourceCounts.warnings > 0 ? (
                    <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-700 dark:text-amber-300">
                      {resourceCounts.warnings} warnings
                    </span>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="mt-5 min-h-0 overflow-y-auto pr-1">
              {state.status === "idle" || state.status === "loading" ? (
                <div role="status" className="rounded-2xl border border-dashed border-black/15 p-10 text-center text-sm text-black/45 dark:border-white/15 dark:text-white/45">
                  Loading captured settings…
                </div>
              ) : state.status === "error" ? (
                <div role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/8 p-5 text-sm text-red-700 dark:text-red-300">
                  <p>{state.message}</p>
                  <button type="button" onClick={() => { setState({ status: "idle" }); void openInspector(); }} className="mt-3 rounded-md border border-current px-3 py-1.5 text-xs font-semibold">
                    Try again
                  </button>
                </div>
              ) : !loadedConfiguration || !hasCapturedResources ? (
                <div className="rounded-2xl border border-dashed border-black/15 p-8 text-center dark:border-white/15">
                  <p className="font-medium">No optional settings were captured.</p>
                  <p className="mt-1 text-sm text-black/45 dark:text-white/45">
                    This is a catalog-only version. Create a new version to capture channel and store configuration.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {configurationGroups.map((groupDefinition) => {
                    const group = loadedConfiguration[groupDefinition.id];
                    const resources = Object.entries(group?.resources ?? {}) as Array<[
                      string,
                      CapturedConfigurationResource,
                    ]>;
                    if (resources.length === 0) return null;

                    return (
                      <section key={groupDefinition.id} aria-labelledby={`settings-group-${groupDefinition.id}`} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 id={`settings-group-${groupDefinition.id}`} className="font-semibold">{groupDefinition.label}</h3>
                            <p className="mt-1 text-xs leading-5 text-black/45 dark:text-white/45">{groupDefinition.description}</p>
                          </div>
                          <span className="rounded-full bg-black/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-black/45 dark:bg-white/8 dark:text-white/45">
                            {groupDefinition.scope === "store" ? "Store-wide" : groupDefinition.scope === "mixed" ? "Mixed scope" : "Channel"}
                          </span>
                        </div>

                        <div className="mt-3 space-y-2">
                          {resources.map(([resourceKey, resource]) => (
                            <details key={resourceKey} className="group rounded-xl border border-black/8 bg-black/2 open:bg-black/3 dark:border-white/8 dark:bg-white/3 dark:open:bg-white/5">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">{resource.label}</span>
                                  <span className="mt-1 flex flex-wrap gap-1.5">
                                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] text-black/45 dark:bg-white/8 dark:text-white/45">{scopeLabels[resource.scope]}</span>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${resource.warning ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : resourceHasData(resource) ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-black/5 text-black/45 dark:bg-white/8 dark:text-white/45"}`}>
                                      {resource.warning ? "Warning" : resourceHasData(resource) ? "Captured" : "Empty"}
                                    </span>
                                  </span>
                                </span>
                                <span aria-hidden="true" className="shrink-0 text-black/35 transition group-open:rotate-180 dark:text-white/35">⌄</span>
                              </summary>
                              <div className="border-t border-black/8 px-3 py-3 dark:border-white/8">
                                {resource.warning ? <p className="mb-3 rounded-lg bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200">{resource.warning}</p> : null}
                                <pre className="max-h-80 overflow-auto rounded-lg bg-neutral-950 p-3 text-[11px] leading-5 text-neutral-100 dark:bg-black">{formatResourceData(resource.data)}</pre>
                              </div>
                            </details>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
