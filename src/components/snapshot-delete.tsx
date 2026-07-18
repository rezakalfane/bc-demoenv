"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { deleteSnapshotSeries } from "@/app/(app)/snapshots/delete-actions";
import { TrashIcon } from "@/components/action-icons";
import { useCatalogOperationActive } from "@/components/catalog-operation-progress";

export function SnapshotDelete({
  snapshotId,
  snapshotName,
  versionCount,
}: {
  snapshotId: number;
  snapshotName: string;
  versionCount: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isActionInProgress = useCatalogOperationActive({ snapshotId });

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) setIsOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isPending]);

  function close() {
    if (isPending) return;
    setIsOpen(false);
    setConfirmation("");
    setError(null);
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteSnapshotSeries(snapshotId, confirmation);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={isActionInProgress}
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-500/35 bg-red-500/7 px-3 py-1.5 text-[11px] leading-none font-semibold text-red-700 transition hover:bg-red-500/14 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:text-red-300"
      >
        <TrashIcon />
        Delete snapshot
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
            aria-labelledby="delete-snapshot-title"
            className="w-full max-w-lg rounded-3xl border border-red-500/20 bg-white p-6 shadow-2xl sm:p-7 dark:bg-neutral-950"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-300">
                  Permanent deletion
                </p>
                <h2 id="delete-snapshot-title" className="mt-1 text-2xl font-semibold tracking-[-0.03em]">
                  Delete {snapshotName}?
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close delete snapshot dialog"
                disabled={isPending}
                onClick={close}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-black/10 text-lg text-black/45 transition hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8"
              >
                ×
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/8 p-4 text-sm leading-6 text-red-900 dark:text-red-200">
              This deletes the complete snapshot series and all {versionCount} {versionCount === 1 ? "version" : "versions"}. This cannot be undone.
            </div>

            <label className="mt-5 block text-sm font-medium">
              Type <span className="font-mono">DELETE</span> to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={isPending}
                autoComplete="off"
                className="mt-2 w-full rounded-xl border border-black/12 bg-transparent px-3.5 py-3 outline-none transition focus:border-red-500 focus:ring-2 focus:ring-red-500/15 disabled:opacity-50 dark:border-white/12"
              />
            </label>

            {error ? <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={close} disabled={isPending} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/8">
                Cancel
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={isPending || confirmation !== "DELETE"}
                className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isPending ? "Deleting…" : "Delete all versions"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
