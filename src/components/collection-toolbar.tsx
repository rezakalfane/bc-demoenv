"use client";

import { useDeferredValue, useEffect, useState, useTransition } from "react";
import {
  saveCollectionSharedVisibility,
  saveCollectionViewMode,
} from "@/app/(app)/collection-preference-actions";
import { useCollectionPreference } from "@/components/collection-preferences-provider";

type CollectionView = "cards" | "table";

function CardsIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
}

function TableIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 4v16" /></svg>;
}

function SharedIcon({ visible }: { visible: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" />{!visible ? <path d="m4 4 16 16" /> : null}</svg>;
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>;
}

export function CollectionToolbar({
  collectionId,
  ariaLabel,
  searchPlaceholder,
  itemCount,
  allowSharedToggle,
  initialView,
  initialShowShared,
}: {
  collectionId: string;
  ariaLabel: string;
  searchPlaceholder: string;
  itemCount: number;
  allowSharedToggle: boolean;
  initialView: CollectionView;
  initialShowShared: boolean;
}) {
  const [view, setView] = useState<CollectionView>(initialView);
  const [query, setQuery] = useState("");
  const [showShared, setShowShared] = useState(initialShowShared);
  const [saveError, setSaveError] = useState("");
  const [, startTransition] = useTransition();
  const { updatePreference } = useCollectionPreference(collectionId);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase("en-US"));

  function selectView(nextView: CollectionView) {
    setView(nextView);
    updatePreference(collectionId, { viewMode: nextView });
    setSaveError("");
    startTransition(async () => {
      try {
        const result = await saveCollectionViewMode(collectionId, nextView);
        if (result.error) setSaveError(result.error);
      } catch {
        setSaveError("The display preference could not be saved.");
      }
    });
  }

  function toggleShared() {
    const nextShowShared = !showShared;
    setShowShared(nextShowShared);
    updatePreference(collectionId, { showShared: nextShowShared });
    setSaveError("");
    startTransition(async () => {
      try {
        const result = await saveCollectionSharedVisibility(
          collectionId,
          nextShowShared,
        );
        if (result.error) setSaveError(result.error);
      } catch {
        setSaveError("The shared snapshot preference could not be saved.");
      }
    });
  }

  useEffect(() => {
    const root = document.getElementById(collectionId);
    if (!root) return;
    const cards = root.querySelector<HTMLElement>("[data-collection-cards]");
    const table = root.querySelector<HTMLElement>("[data-collection-table]");
    const empty = root.querySelector<HTMLElement>("[data-collection-empty]");
    cards?.toggleAttribute("hidden", view !== "cards");
    table?.toggleAttribute("hidden", view !== "table");
    let visibleEntries = 0;
    root.querySelectorAll<HTMLElement>("[data-collection-entry]").forEach((entry) => {
      const matchesSearch = !deferredQuery || (entry.dataset.searchText ?? "").includes(deferredQuery);
      const matchesSharing = showShared || entry.dataset.shared !== "true";
      const visible = matchesSearch && matchesSharing;
      entry.toggleAttribute("hidden", !visible);
      if (visible && entry.parentElement === cards) visibleEntries += 1;
    });
    empty?.toggleAttribute("hidden", visibleEntries > 0);
    if (visibleEntries === 0) {
      cards?.setAttribute("hidden", "");
      table?.setAttribute("hidden", "");
    }
  }, [collectionId, deferredQuery, itemCount, showShared, view]);

  const buttonClass = (active: boolean) => `inline-flex size-8 items-center justify-center rounded-lg border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${active ? "border-emerald-600/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "border-black/10 bg-white/60 text-black/45 hover:bg-black/5 hover:text-black dark:border-white/10 dark:bg-white/5 dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white"}`;

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <label className="relative block w-full max-w-sm">
          <span className="sr-only">Search {ariaLabel.toLocaleLowerCase("en-US")}</span>
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-black/35 dark:text-white/35"><SearchIcon /></span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="h-9 w-full rounded-xl border border-black/10 bg-white/65 pr-3 pl-9 text-sm outline-none transition placeholder:text-black/30 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-white/10 dark:bg-white/5 dark:placeholder:text-white/30" />
        </label>
        <span className="shrink-0 text-xs tabular-nums text-black/40 dark:text-white/40">{itemCount} items</span>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-1.5" role="toolbar" aria-label={`${ariaLabel} display options`}>
        {allowSharedToggle ? <button type="button" aria-label={showShared ? "Hide shared snapshots" : "Show shared snapshots"} aria-pressed={showShared} title={showShared ? "Hide shared snapshots" : "Show shared snapshots"} className={`${buttonClass(showShared)} mr-1 text-blue-600 dark:text-blue-300`} onClick={toggleShared}><SharedIcon visible={showShared} /></button> : null}
        <button type="button" aria-label="Cards view" aria-pressed={view === "cards"} title="Cards view" className={buttonClass(view === "cards")} onClick={() => selectView("cards")}><CardsIcon /></button>
        <button type="button" aria-label="Compact table view" aria-pressed={view === "table"} title="Compact table view" className={buttonClass(view === "table")} onClick={() => selectView("table")}><TableIcon /></button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{saveError}</p>
    </div>
  );
}
