"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { compareSnapshotVersions } from "@/app/(app)/snapshots/diff-actions";
import { InspectIcon } from "@/components/action-icons";
import type { CatalogSnapshotDiff, SnapshotDiffChangeKind } from "@/lib/catalog-snapshot-diff";

type VersionOption = {
  id: number;
  snapshotVersion: number;
  createdAt: string;
  publishedAt: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const changeStyles: Record<SnapshotDiffChangeKind, string> = {
  added: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  removed: "bg-red-500/12 text-red-700 dark:text-red-300",
  changed: "bg-amber-500/14 text-amber-800 dark:text-amber-300",
};

export function SnapshotVersionDiff({
  name,
  currentSnapshotId,
  versions,
}: {
  name: string;
  currentSnapshotId: number;
  versions: VersionOption[];
}) {
  const currentIndex = Math.max(0, versions.findIndex((version) => version.id === currentSnapshotId));
  const defaultFrom = versions.find((version) => version.id !== currentSnapshotId) ?? versions[0];
  const defaultTo = versions[currentIndex] ?? versions[0];
  const [isOpen, setIsOpen] = useState(false);
  const [fromId, setFromId] = useState(defaultFrom?.id ?? 0);
  const [toId, setToId] = useState(defaultTo?.id ?? 0);
  const [diff, setDiff] = useState<CatalogSnapshotDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const modalRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function runComparison() {
    setError(null);
    setDiff(null);
    setExpandedSection(null);
    startTransition(async () => {
      const result = await compareSnapshotVersions(fromId, toId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDiff(result.data);
    });
  }

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
      if (event.key !== "Tab") return;
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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

  if (versions.length < 2) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-6 items-center justify-center gap-1 rounded-md border border-black/10 bg-white/70 px-2.5 text-[10px] leading-none font-semibold transition hover:border-emerald-500/30 hover:bg-emerald-500/8 hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-white/10 dark:bg-white/5 dark:hover:text-emerald-300"
      >
        <InspectIcon />
        Compare versions
      </button>

      {isOpen ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
          className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
        >
          <section
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="snapshot-diff-title"
            aria-describedby="snapshot-diff-description"
            className="flex max-h-[min(54rem,calc(100vh-2rem))] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/12 bg-white shadow-2xl dark:bg-neutral-950"
          >
            <header className="flex items-start justify-between gap-5 border-b border-black/8 p-6 sm:p-7 dark:border-white/8">
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Snapshot comparison</p>
                <h2 id="snapshot-diff-title" className="mt-1 truncate text-2xl font-semibold tracking-[-0.03em]">
                  Compare versions of {name}
                </h2>
                <p id="snapshot-diff-description" className="mt-2 text-sm text-black/50 dark:text-white/50">
                  Review catalog and captured configuration changes from the first version to the second.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close snapshot comparison"
                onClick={() => setIsOpen(false)}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-black/10 text-lg text-black/45 transition hover:bg-black/5 hover:text-black dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
              >
                ×
              </button>
            </header>

            <div className="min-h-0 overflow-y-auto p-6 sm:p-7">
              <div className="grid gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/7 p-4 md:grid-cols-[1fr_auto_1fr_auto] md:items-end">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800 dark:text-emerald-300">
                  From
                  <select
                    value={fromId}
                    onChange={(event) => setFromId(Number(event.target.value))}
                    className="mt-2 block h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-medium normal-case tracking-normal text-black outline-none focus:border-emerald-500 dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                  >
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.publishedAt ? "◉ " : ""}Version {version.snapshotVersion} · {dateFormatter.format(new Date(version.createdAt))}
                      </option>
                    ))}
                  </select>
                </label>
                <span aria-hidden className="hidden pb-2 text-lg text-black/35 md:block dark:text-white/35">→</span>
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800 dark:text-emerald-300">
                  To
                  <select
                    value={toId}
                    onChange={(event) => setToId(Number(event.target.value))}
                    className="mt-2 block h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-medium normal-case tracking-normal text-black outline-none focus:border-emerald-500 dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                  >
                    {versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.publishedAt ? "◉ " : ""}Version {version.snapshotVersion} · {dateFormatter.format(new Date(version.createdAt))}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={isPending || fromId === toId}
                  onClick={runComparison}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {isPending ? <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white" /> : <InspectIcon />}
                  {isPending ? "Comparing…" : "Compare"}
                </button>
              </div>

              {error ? <p role="alert" className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

              {diff ? (
                <div className="mt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">
                      Version {diff.from.version} <span className="text-black/35 dark:text-white/35">→</span> Version {diff.to.version}
                    </p>
                    <p className={`rounded-full px-2.5 py-1 text-xs font-semibold ${diff.hasChanges ? "bg-amber-500/14 text-amber-800 dark:text-amber-300" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"}`}>
                      {diff.hasChanges ? "Changes found" : "No differences"}
                    </p>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-2xl border border-black/8 dark:border-white/8">
                    <table className="w-full table-fixed text-left text-xs">
                      <thead className="bg-black/4 text-black/50 dark:bg-white/5 dark:text-white/50">
                        <tr>
                          <th className="w-[36%] px-4 py-3 font-semibold">Resource</th>
                          <th className="px-2 py-3 text-center font-semibold text-emerald-700 dark:text-emerald-300">Added</th>
                          <th className="px-2 py-3 text-center font-semibold text-red-700 dark:text-red-300">Removed</th>
                          <th className="px-2 py-3 text-center font-semibold text-amber-700 dark:text-amber-300">Changed</th>
                          <th className="px-2 py-3 text-center font-semibold">Unchanged</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/7 dark:divide-white/7">
                        {diff.sections.map((section) => (
                          <tr key={section.id}>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                disabled={section.entries.length === 0}
                                onClick={() => setExpandedSection(expandedSection === section.id ? null : section.id)}
                                className="font-semibold transition hover:text-emerald-700 disabled:cursor-default disabled:hover:text-inherit dark:hover:text-emerald-300"
                              >
                                <span aria-hidden>{section.entries.length > 0 ? (expandedSection === section.id ? "▾" : "▸") : "·"}</span>{" "}{section.label}
                              </button>
                            </td>
                            <td className="px-2 py-3 text-center tabular-nums">{section.added}</td>
                            <td className="px-2 py-3 text-center tabular-nums">{section.removed}</td>
                            <td className="px-2 py-3 text-center tabular-nums">{section.changed}</td>
                            <td className="px-2 py-3 text-center tabular-nums text-black/40 dark:text-white/40">{section.unchanged}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {diff.sections.map((section) => expandedSection === section.id ? (
                    <section key={section.id} className="mt-4 rounded-2xl border border-black/8 bg-black/2 p-4 dark:border-white/8 dark:bg-white/3">
                      <h3 className="font-semibold">{section.label} changes</h3>
                      <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-black/7 bg-white dark:border-white/7 dark:bg-neutral-950">
                        <table className="w-full table-fixed text-left text-xs">
                          <thead className="sticky top-0 bg-neutral-100 text-black/50 dark:bg-neutral-900 dark:text-white/50">
                            <tr><th className="w-24 px-3 py-2 font-semibold">Change</th><th className="px-3 py-2 font-semibold">Record</th><th className="w-[38%] px-3 py-2 font-semibold">Fields</th></tr>
                          </thead>
                          <tbody className="divide-y divide-black/7 dark:divide-white/7">
                            {section.entries.map((entry) => (
                              <tr key={`${entry.change}:${entry.key}`}>
                                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${changeStyles[entry.change]}`}>{entry.change}</span></td>
                                <td className="truncate px-3 py-2 font-medium" title={entry.label}>{entry.label}</td>
                                <td className="truncate px-3 py-2 text-black/45 dark:text-white/45" title={entry.fields.join(", ")}>{entry.fields.length ? entry.fields.join(", ") : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {section.omittedEntries > 0 ? <p className="mt-2 text-xs text-black/45 dark:text-white/45">{section.omittedEntries} additional changes are omitted from this preview.</p> : null}
                    </section>
                  ) : null)}
                </div>
              ) : !isPending ? (
                <div className="mt-5 rounded-2xl border border-dashed border-black/12 px-5 py-10 text-center text-sm text-black/45 dark:border-white/12 dark:text-white/45">
                  Select the direction of comparison, then choose Compare.
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
