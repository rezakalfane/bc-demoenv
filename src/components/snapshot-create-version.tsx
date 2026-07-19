"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createNextSnapshotVersion } from "@/app/(app)/snapshots/actions";
import {
  startCatalogOperation,
  useCatalogOperationActive,
} from "@/components/catalog-operation-progress";
import { PlusIcon } from "@/components/action-icons";

type LatestSnapshotVersion = {
  id: number;
  name: string;
  snapshotVersion: number;
  sourceEnvironmentName: string;
  sourceChannelName: string;
  categoryCount: number;
  productCount: number;
  variantCount: number;
  imageCount: number;
  metafieldCount: number;
  updatedAt: string;
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function SnapshotCreateVersion({
  viewedSnapshotId,
  latest,
}: {
  viewedSnapshotId: number;
  latest: LatestSnapshotVersion;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const closeRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const isActionInProgress = useCatalogOperationActive({ snapshotId: viewedSnapshotId });

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) setIsOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isPending]);

  function close() {
    if (isPending) return;
    setIsOpen(false);
    setError(null);
  }

  function open() {
    setError(null);
    setIsOpen(true);
  }

  function createVersion() {
    setError(null);
    startTransition(async () => {
      const result = await createNextSnapshotVersion(latest.id);
      if (result.error || !result.operationId || !result.environmentId || !result.channelId) {
        setError(result.error ?? "The snapshot capture could not be started.");
        return;
      }
      startCatalogOperation({
        kind: "snapshot",
        environmentId: result.environmentId,
        channelId: result.channelId,
        snapshotId: viewedSnapshotId,
        operationId: result.operationId,
        originPath: `/snapshots/${viewedSnapshotId}`,
      });
      setIsOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={isActionInProgress}
        onClick={open}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-600/25 bg-emerald-500/10 px-3 py-1.5 text-[11px] leading-none font-semibold text-emerald-800 transition hover:bg-emerald-500/16 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:text-emerald-300"
      >
        <PlusIcon />
        Create new version
      </button>

      {isOpen ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-version-title"
            aria-describedby="create-version-description"
            className="w-full max-w-lg rounded-3xl border border-white/12 bg-white p-6 text-left shadow-2xl sm:p-7 dark:bg-neutral-950"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Catalog snapshot</p>
                <h2 id="create-version-title" className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
                  Create version {latest.snapshotVersion + 1}?
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                aria-label="Close new version confirmation"
                disabled={isPending}
                onClick={close}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-black/10 text-lg text-black/45 transition hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8"
              >
                ×
              </button>
            </div>

            <p id="create-version-description" className="mt-3 text-sm leading-6 text-black/55 dark:text-white/55">
              The latest version&apos;s source will be captured again. Existing versions remain unchanged.
            </p>

            <div className="mt-5 rounded-2xl border border-black/8 bg-black/2.5 p-4 dark:border-white/8 dark:bg-white/4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{latest.name}</p>
                  <p className="mt-1 text-xs text-black/45 dark:text-white/45">
                    {latest.sourceEnvironmentName} · {latest.sourceChannelName}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  v{latest.snapshotVersion} → v{latest.snapshotVersion + 1}
                </span>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                {[
                  ["Categories", latest.categoryCount],
                  ["Products", latest.productCount],
                  ["Variants", latest.variantCount],
                  ["Images", latest.imageCount],
                  ["Metafields", latest.metafieldCount],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-black/40 dark:text-white/40">{label}</dt>
                    <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 border-t border-black/8 pt-3 text-xs text-black/40 dark:border-white/8 dark:text-white/40">
                Latest capture {dateFormatter.format(new Date(latest.updatedAt))}
              </p>
            </div>

            {error ? <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={close} disabled={isPending} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/8">
                Cancel
              </button>
              <button type="button" onClick={createVersion} disabled={isPending || Boolean(error?.startsWith("Another catalog action"))} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-50 dark:bg-emerald-400 dark:text-neutral-950 dark:hover:bg-emerald-300">
                {isPending ? "Starting capture…" : `Create version ${latest.snapshotVersion + 1}`}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
