"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { renameSnapshot } from "@/app/(app)/snapshots/rename-actions";
import { PublishedIcon } from "@/components/action-icons";

export function SnapshotInlineName({
  snapshotId,
  name,
  published = false,
}: {
  snapshotId: number;
  name: string;
  published?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [currentName, setCurrentName] = useState(name);
  const [draftName, setDraftName] = useState(name);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  function beginEditing() {
    setDraftName(currentName);
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setDraftName(currentName);
    setError(null);
    setEditing(false);
  }

  function save() {
    if (pending) return;
    startTransition(async () => {
      const result = await renameSnapshot(snapshotId, draftName);
      if (result.error || !result.name) {
        setError(result.error ?? "The snapshot could not be renamed.");
        return;
      }
      setCurrentName(result.name);
      setDraftName(result.name);
      setError(null);
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <div className="min-w-0">
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            ref={inputRef}
            aria-label="Snapshot name"
            className="w-[min(80vw,30ch)] min-w-0 max-w-full rounded-lg border border-emerald-500/60 bg-white/80 px-2 py-1 text-3xl font-semibold tracking-[-0.04em] outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/25 sm:text-4xl dark:bg-white/8"
            disabled={pending}
            maxLength={80}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEditing();
              }
            }}
            value={draftName}
          />
          <button
            type="submit"
            className="rounded-lg border border-emerald-600/35 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/10 disabled:cursor-wait disabled:opacity-50 dark:text-emerald-300"
            disabled={pending}
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold text-black/55 transition hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:text-white/55 dark:hover:bg-white/5"
            disabled={pending}
            onClick={cancelEditing}
          >
            Cancel
          </button>
        </form>
      ) : (
        <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
          <button
            type="button"
            aria-label={`Rename snapshot ${currentName}`}
            className="break-words rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
            onDoubleClick={beginEditing}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "F2") {
                event.preventDefault();
                beginEditing();
              }
            }}
            title="Double-click to rename"
          >
            {currentName}
            {published ? (
              <>
                <PublishedIcon className="ml-2 inline-block align-[-0.08em] text-blue-600 dark:text-blue-300" />
                <span className="sr-only"> Published snapshot</span>
              </>
            ) : null}
          </button>
        </h1>
      )}
      {error ? <p role="alert" className="mt-2 text-xs font-medium text-red-700 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
