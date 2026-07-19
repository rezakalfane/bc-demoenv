"use client";

import { useEffect, useRef, useState } from "react";
import type { CatalogHistoryEntry } from "@/lib/catalog-history";
import { HistoryIcon } from "@/components/action-icons";

const formatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export function CatalogHistory({ title, entries }: { title: string; entries: CatalogHistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    queueMicrotask(() => closeRef.current?.focus());
    return () => { document.body.style.overflow = overflow; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-black/10 bg-white/60 px-3 py-1.5 text-[11px] leading-none font-semibold transition hover:bg-black/5 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"><HistoryIcon />History</button>
    {open ? <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }} className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="catalog-history-title" className="w-full max-w-2xl rounded-3xl border border-white/12 bg-white p-6 shadow-2xl dark:bg-neutral-950">
        <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Activity log</p><h2 id="catalog-history-title" className="mt-1 text-2xl font-semibold">{title}</h2></div><button ref={closeRef} type="button" aria-label="Close history" onClick={() => setOpen(false)} className="grid size-9 place-items-center rounded-full border border-black/10 text-lg dark:border-white/10">×</button></div>
        <div className="mt-6 max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          {entries.length === 0 ? <p className="rounded-2xl border border-dashed border-black/15 p-8 text-center text-sm text-black/45 dark:border-white/15 dark:text-white/45">No catalog activity has been recorded yet.</p> : entries.map((entry) => <article key={entry.id} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{entry.title}</h3><time dateTime={entry.createdAt} className="mt-1 block text-xs text-black/40 dark:text-white/40">{formatter.format(new Date(entry.createdAt))}</time></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${entry.status === "completed" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : entry.status === "failed" ? "bg-red-500/12 text-red-700 dark:text-red-300" : "bg-amber-500/12 text-amber-700 dark:text-amber-300"}`}>{entry.status}</span></div>
            {entry.details.length ? <ul className="mt-3 space-y-1 text-xs leading-5 text-black/55 dark:text-white/55">{entry.details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}
            {entry.manualActions.length ? <div className="mt-3 space-y-2">{entry.manualActions.map((action) => <div key={`${action.href}-${action.label}`} className="rounded-xl border border-blue-500/25 bg-blue-500/8 p-3">
              <p className="text-xs leading-5 text-blue-950/70 dark:text-blue-100/70">{action.description}</p>
              <a href={action.href} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center rounded-md border border-blue-500/30 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-500/10 dark:text-blue-300">{action.label} ↗</a>
            </div>)}</div> : null}
            {entry.error ? <p className="mt-3 rounded-xl bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">{entry.error}</p> : null}
          </article>)}
        </div>
      </section>
    </div> : null}
  </>;
}
