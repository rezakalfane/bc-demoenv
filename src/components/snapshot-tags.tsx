"use client";

import { useMemo, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import {
  addSnapshotTag,
  removeSnapshotTag,
} from "@/app/(app)/snapshots/tag-actions";

function PlusIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m7 7 10 10M17 7 7 17" /></svg>;
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function SnapshotTags({
  snapshotId,
  initialTags,
  suggestions,
  editable,
}: {
  snapshotId: number;
  initialTags: string[];
  suggestions: string[];
  editable: boolean;
}) {
  const [tags, setTags] = useState(initialTags);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const matchingSuggestions = useMemo(() => {
    const query = normalize(draft);
    const selected = new Set(tags.map(normalize));
    return suggestions
      .filter((suggestion) => !selected.has(normalize(suggestion)))
      .filter((suggestion) => !query || normalize(suggestion).includes(query))
      .slice(0, 6);
  }, [draft, suggestions, tags]);

  function addTag(requestedTag: string) {
    const tag = requestedTag.trim().replace(/\s+/g, " ");
    if (!tag) return;
    if (tags.some((currentTag) => normalize(currentTag) === normalize(tag))) {
      setError("This tag is already attached.");
      return;
    }
    if (tags.length >= 12) {
      setError("A snapshot can have up to 12 custom tags.");
      return;
    }
    setError("");
    setTags((current) => [...current, tag].toSorted((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })));
    setDraft("");
    setEditorOpen(false);
    startTransition(async () => {
      try {
        const result = await addSnapshotTag(snapshotId, tag);
        if (!result.error) return;
        setTags((current) => current.filter((currentTag) => normalize(currentTag) !== normalize(tag)));
        setError(result.error);
      } catch {
        setTags((current) => current.filter((currentTag) => normalize(currentTag) !== normalize(tag)));
        setError("The tag could not be saved. Please try again.");
      }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addTag(draft);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setEditorOpen(false);
      setDraft("");
      setError("");
      return;
    }
    if (matchingSuggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((index) => (index + 1) % matchingSuggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((index) => (index - 1 + matchingSuggestions.length) % matchingSuggestions.length);
    } else if (event.key === "Enter" && matchingSuggestions[activeSuggestion]) {
      event.preventDefault();
      addTag(matchingSuggestions[activeSuggestion]);
    }
  }

  function removeTag(tag: string) {
    setError("");
    setTags((current) => current.filter((currentTag) => normalize(currentTag) !== normalize(tag)));
    startTransition(async () => {
      try {
        const result = await removeSnapshotTag(snapshotId, tag);
        if (!result.error) return;
        setTags((current) => current.some((currentTag) => normalize(currentTag) === normalize(tag))
          ? current
          : [...current, tag].toSorted((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })));
        setError(result.error);
      } catch {
        setTags((current) => current.some((currentTag) => normalize(currentTag) === normalize(tag))
          ? current
          : [...current, tag].toSorted((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })));
        setError("The tag could not be removed. Please try again.");
      }
    });
  }

  return (
    <>
      {tags.map((tag) => (
        <div key={normalize(tag)} className="inline-flex min-h-7 items-center gap-1 rounded-full border border-emerald-600/20 bg-emerald-500/8 px-3 py-1 text-xs text-emerald-800 dark:text-emerald-300">
          <span className="sr-only">Custom tag: </span>
          <span>{tag}</span>
          {editable ? (
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              title={`Remove tag ${tag}`}
              className="-mr-1 inline-flex size-4 items-center justify-center rounded-full text-current/55 transition hover:bg-emerald-500/15 hover:text-current focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600"
              onClick={() => removeTag(tag)}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      ))}

      {editable ? (
        <div className="relative">
          <button
            type="button"
            aria-label="Add a custom snapshot tag"
            aria-expanded={editorOpen}
            title="Add custom tag"
            disabled={tags.length >= 12}
            className="inline-flex size-7 items-center justify-center rounded-full border border-dashed border-black/20 bg-white/45 text-black/45 transition hover:border-emerald-500/45 hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:bg-white/4 dark:text-white/45 dark:hover:text-emerald-300"
            onClick={() => {
              setEditorOpen((open) => !open);
              setError("");
              setActiveSuggestion(0);
            }}
          >
            <PlusIcon />
          </button>

          {editorOpen ? (
            <div className="absolute top-9 left-0 z-30 w-64 rounded-2xl border border-black/10 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-neutral-950">
              <form onSubmit={submit}>
                <label className="sr-only" htmlFor={`snapshot-tag-${snapshotId}`}>Custom snapshot tag</label>
                <input
                  id={`snapshot-tag-${snapshotId}`}
                  autoFocus
                  value={draft}
                  maxLength={32}
                  placeholder="Add a tag…"
                  autoComplete="off"
                  className="h-9 w-full rounded-xl border border-black/10 bg-black/[0.025] px-3 text-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 dark:border-white/10 dark:bg-white/5"
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setActiveSuggestion(0);
                    setError("");
                  }}
                  onKeyDown={handleInputKeyDown}
                />
                {matchingSuggestions.length > 0 ? (
                  <div className="mt-1 border-t border-black/6 pt-1 dark:border-white/6" role="listbox" aria-label="Existing tags">
                    {matchingSuggestions.map((suggestion, index) => (
                      <button
                        key={normalize(suggestion)}
                        type="button"
                        role="option"
                        aria-selected={index === activeSuggestion}
                        className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition ${index === activeSuggestion ? "bg-emerald-500/12 text-emerald-800 dark:text-emerald-300" : "hover:bg-black/5 dark:hover:bg-white/8"}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => addTag(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center justify-between gap-2 px-1">
                  <span className="min-w-0 text-[11px] text-red-600 dark:text-red-300" role="status">{error}</span>
                  <button type="submit" disabled={!draft.trim()} className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45">
                    Add
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
      {pending ? <span className="self-center text-[11px] text-black/35 dark:text-white/35" role="status">Saving tags…</span> : null}
      {!editorOpen && error ? <span className="self-center text-xs text-red-600 dark:text-red-300" role="status">{error}</span> : null}
    </>
  );
}
