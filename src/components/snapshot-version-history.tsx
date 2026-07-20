"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteSnapshotVersion } from "@/app/(app)/snapshots/delete-actions";
import { setSnapshotVersionPublished } from "@/app/(app)/snapshots/publish-actions";
import { PublishedIcon, TrashIcon, VersionsIcon } from "@/components/action-icons";
import { useCatalogOperationActive } from "@/components/catalog-operation-progress";

export type SnapshotVersionOption = {
  id: number;
  snapshotVersion: number;
  sourceEnvironmentName: string;
  sourceChannelName: string;
  categoryCount: number;
  productCount: number;
  variantCount: number;
  payloadBytes: number;
  createdAt: string;
  publishedAt: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function SnapshotVersionHistory({
  name,
  currentSnapshotId,
  versions,
}: {
  name: string;
  currentSnapshotId: number;
  versions: SnapshotVersionOption[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState<SnapshotVersionOption | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isPublishing, startPublishTransition] = useTransition();
  const [publishError, setPublishError] = useState<string | null>(null);
  const isActionInProgress = useCatalogOperationActive({ snapshotId: currentSnapshotId });
  const router = useRouter();
  const modalRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const latestVersion = versions.reduce<SnapshotVersionOption | null>((latest, version) => {
    if (!latest || version.snapshotVersion > latest.snapshotVersion) return version;
    if (version.snapshotVersion === latest.snapshotVersion && version.id > latest.id) return version;
    return latest;
  }, null);

  function removeVersion() {
    if (!versionToDelete || !latestVersion) return;
    const deletedId = versionToDelete.id;
    setDeleteError(null);
    startDeleteTransition(async () => {
      const result = await deleteSnapshotVersion(deletedId, currentSnapshotId);
      if (result.error) {
        setDeleteError(result.error);
        return;
      }
      setVersionToDelete(null);
      router.refresh();
    });
  }

  function updatePublishedVersion(version: SnapshotVersionOption) {
    setPublishError(null);
    startPublishTransition(async () => {
      const result = await setSnapshotVersionPublished(version.id, !version.publishedAt);
      if (result.error) {
        setPublishError(result.error);
        return;
      }
      router.refresh();
    });
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (event.key === "Tab") {
        const focusableElements = modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        const firstElement = focusableElements?.[0];
        const lastElement = focusableElements?.[focusableElements.length - 1];

        if (
          event.shiftKey &&
          firstElement &&
          document.activeElement === firstElement
        ) {
          event.preventDefault();
          lastElement?.focus();
        } else if (
          !event.shiftKey &&
          lastElement &&
          document.activeElement === lastElement
        ) {
          event.preventDefault();
          firstElement?.focus();
        }
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
        onClick={() => setIsOpen(true)}
        className="inline-flex h-6 items-center justify-center gap-1 rounded-md bg-neutral-950 px-2.5 text-[10px] leading-none font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:bg-white dark:text-neutral-950 dark:hover:bg-emerald-300"
      >
        <VersionsIcon />
        Choose version
      </button>

      {isOpen ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false);
            }
          }}
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
        >
          <section
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="snapshot-history-title"
            aria-describedby="snapshot-history-description"
            className="flex max-h-[min(48rem,calc(100vh-2rem))] w-full max-w-2xl flex-col rounded-3xl border border-white/12 bg-white p-6 shadow-2xl sm:p-7 dark:bg-neutral-950"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Version history
                </p>
                <h2
                  id="snapshot-history-title"
                  className="mt-1 truncate text-2xl font-semibold tracking-[-0.03em]"
                >
                  Choose a version of {name}
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close version history"
                onClick={() => setIsOpen(false)}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-black/10 text-lg text-black/45 transition hover:bg-black/5 hover:text-black dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
              >
                ×
              </button>
            </div>

            <p
              id="snapshot-history-description"
              className="mt-3 text-sm leading-6 text-black/55 dark:text-white/55"
            >
              Choose an immutable catalog version to inspect. Opening a version
              does not modify a store; restore it from that version&apos;s detail page.
            </p>

            <div className="mt-5 min-h-0 space-y-3 overflow-y-auto pr-1">
              {publishError ? (
                <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {publishError}
                </p>
              ) : null}
              {versions.map((version) => {
                const isCurrent = version.id === currentSnapshotId;
                const isLatest = version.id === latestVersion?.id;

                return (
                  <article
                    key={version.id}
                    className={`rounded-2xl border p-4 ${
                      isCurrent
                        ? "border-emerald-500/35 bg-emerald-500/7"
                        : "border-black/8 bg-black/2 dark:border-white/8 dark:bg-white/3"
                    }`}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            Version {version.snapshotVersion}
                          </h3>
                          {isCurrent ? (
                            <span className="rounded-full bg-emerald-500/14 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                              Viewing
                            </span>
                          ) : null}
                          {isLatest ? (
                            <span className="rounded-full bg-black/6 px-2 py-0.5 text-[11px] font-semibold text-black/55 dark:bg-white/8 dark:text-white/55">
                              Latest
                            </span>
                          ) : null}
                          {version.publishedAt ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/12 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                              <PublishedIcon /> Published
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-black/45 dark:text-white/45">
                          {version.sourceEnvironmentName} · {version.sourceChannelName}
                        </p>
                        <p className="mt-2 text-xs text-black/40 dark:text-white/40">
                          <time dateTime={version.createdAt}>
                            {dateFormatter.format(new Date(version.createdAt))}
                          </time>
                          {" · "}{version.categoryCount} categories · {version.productCount} products · {version.variantCount} variants · {formatBytes(version.payloadBytes)}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={isPublishing || isActionInProgress}
                          onClick={() => updatePublishedVersion(version)}
                          className="inline-flex items-center justify-center gap-1 rounded border border-blue-500/25 px-2 py-1 text-[10px] leading-none font-semibold text-blue-700 transition hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-blue-300"
                        >
                          <PublishedIcon />
                          {version.publishedAt ? "Unpublish" : "Publish"}
                        </button>
                        {!isCurrent ? (
                          <Link
                            href={`/snapshots/${version.id}`}
                            className="inline-flex items-center justify-center gap-1 rounded border border-black/10 px-2 py-1 text-[10px] leading-none font-semibold transition hover:border-emerald-500/30 hover:bg-emerald-500/8 hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-white/10 dark:hover:text-emerald-300"
                          >
                            <VersionsIcon />
                            View version
                          </Link>
                        ) : null}
                        {!isCurrent ? (
                          <button
                            type="button"
                            disabled={isActionInProgress || Boolean(version.publishedAt)}
                            title={version.publishedAt ? "Unpublish this version before deleting it." : undefined}
                            aria-label={version.publishedAt ? `Delete version ${version.snapshotVersion} unavailable: unpublish it first` : `Delete version ${version.snapshotVersion}`}
                            onClick={() => {
                              setDeleteError(null);
                              setVersionToDelete(version);
                            }}
                            className="inline-flex items-center justify-center gap-1 rounded border border-red-500/25 px-2 py-1 text-[10px] leading-none font-semibold text-red-700 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:text-red-300"
                          >
                            <TrashIcon />
                            Delete version
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <p className="mt-5 border-t border-black/8 pt-4 text-xs leading-5 text-black/40 dark:border-white/8 dark:text-white/40">
              Every version is immutable. Choose View version, review its catalog,
              then use Restore Snapshot with the destination you want to provision.
            </p>
          </section>
        </div>
      ) : null}

      {versionToDelete ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-version-title" className="w-full max-w-md rounded-3xl border border-red-500/20 bg-white p-6 shadow-2xl dark:bg-neutral-950">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">Delete older version</p>
            <h2 id="delete-version-title" className="mt-1 text-2xl font-semibold tracking-tight">
              Delete version {versionToDelete.snapshotVersion}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-black/55 dark:text-white/55">
              {versionToDelete.sourceEnvironmentName} · {versionToDelete.sourceChannelName}<br />
              {versionToDelete.productCount} products · {dateFormatter.format(new Date(versionToDelete.createdAt))}
            </p>
            <p className="mt-4 rounded-2xl bg-red-500/8 p-4 text-sm text-red-900 dark:text-red-200">
              This version will be permanently removed. The version currently selected for viewing is protected.
            </p>
            {deleteError ? <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{deleteError}</p> : null}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" disabled={isDeleting} onClick={() => setVersionToDelete(null)} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/8">Cancel</button>
              <button type="button" disabled={isDeleting || isActionInProgress} onClick={removeVersion} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                {isDeleting ? "Deleting…" : "Delete version"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
