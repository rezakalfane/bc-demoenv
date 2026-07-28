"use client";

import {
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useFormStatus } from "react-dom";
import {
  createSnapshot,
  type SnapshotActionState,
  type SnapshotConflict,
} from "@/app/(app)/snapshots/actions";
import { useRouter } from "next/navigation";
import { CATALOG_OPERATION_KEY, startCatalogOperation, useCatalogOperationActive } from "@/components/catalog-operation-progress";
import { CameraIcon } from "@/components/action-icons";
import { useAppI18n } from "@/components/app-i18n-provider";

export type SnapshotNameSuggestion = {
  name: string;
  snapshotVersion: number;
  sourceChannelName: string;
};

const initialState: SnapshotActionState = {
  status: "idle",
  message: "",
  conflict: null,
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

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-55 dark:bg-white dark:text-neutral-950 dark:hover:bg-emerald-300"
    >
      {pending ? "Preparing snapshot…" : "Create snapshot"}
    </button>
  );
}

function SnapshotProgress() {
  return (
    <div className="order-last basis-full rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-emerald-800 dark:text-emerald-200"><span>Capturing snapshot</span><span>Working…</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-950/10 dark:bg-white/10"><div className="h-full w-2/5 animate-pulse rounded-full bg-emerald-500" /></div>
      <p className="mt-2 text-[11px] text-emerald-900/65 dark:text-emerald-100/65">Categories → products → variants, images, and metadata</p>
    </div>
  );
}

function ConfirmVersionButton({
  version,
  buttonRef,
}: {
  version: number;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const { pending } = useFormStatus();
  const { t } = useAppI18n();

  return (
    <button
      ref={buttonRef}
      type="submit"
      disabled={pending}
      className="inline-flex min-w-36 items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-wait disabled:opacity-55 dark:bg-emerald-400 dark:text-neutral-950 dark:hover:bg-emerald-300"
    >
      {pending
        ? t("Capturing version {version}…", { version })
        : t("Create version {version}", { version })}
    </button>
  );
}

function SnapshotNameCombobox({
  inputId,
  listboxId,
  placeholder,
  value,
  suggestions,
  onChange,
}: {
  inputId: string;
  listboxId: string;
  placeholder: string;
  value: string;
  suggestions: SnapshotNameSuggestion[];
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredSuggestions = useMemo(() => {
    const query = value.trim().toLocaleLowerCase();
    const matches = query
      ? suggestions.filter((suggestion) =>
          suggestion.name.toLocaleLowerCase().includes(query),
        )
      : suggestions;

    return matches.slice(0, 8);
  }, [suggestions, value]);
  const activeSuggestion = filteredSuggestions[activeIndex];

  function selectSuggestion(suggestion: SnapshotNameSuggestion) {
    onChange(suggestion.name);
    setIsOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(filteredSuggestions.length - 1, 0)),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && isOpen && activeSuggestion) {
      event.preventDefault();
      selectSuggestion(activeSuggestion);
      return;
    }

    if (event.key === "Escape") {
      queueMicrotask(() => setIsOpen(false));
    }
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false);
        }
      }}
    >
      <input
        id={inputId}
        name="name"
        type="text"
        role="combobox"
        required
        maxLength={80}
        autoComplete="off"
        autoFocus
        aria-autocomplete="list"
        aria-expanded={isOpen && filteredSuggestions.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && activeSuggestion
            ? `${listboxId}-option-${activeSuggestion.snapshotVersion}-${activeIndex}`
            : undefined
        }
        value={value}
        onFocus={() => {
          setActiveIndex(0);
          setIsOpen(true);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setActiveIndex(0);
          setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-black/12 bg-transparent px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 dark:border-white/15"
      />

      {isOpen && filteredSuggestions.length > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Existing snapshot names"
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-2xl border border-black/10 bg-white p-1.5 shadow-2xl dark:border-white/10 dark:bg-neutral-900"
        >
          {filteredSuggestions.map((suggestion, index) => {
            const isActive = index === activeIndex;

            return (
              <button
                key={suggestion.name.toLocaleLowerCase()}
                id={`${listboxId}-option-${suggestion.snapshotVersion}-${index}`}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectSuggestion(suggestion)}
                className={`block w-full rounded-xl px-3 py-2.5 text-left transition ${
                  isActive
                    ? "bg-emerald-500/12 text-emerald-950 dark:text-emerald-100"
                    : "hover:bg-black/4 dark:hover:bg-white/5"
                }`}
              >
                <span className="block truncate text-sm font-semibold">
                  {suggestion.name}
                </span>
                <span className="mt-0.5 block truncate text-xs text-black/45 dark:text-white/45">
                  Version {suggestion.snapshotVersion} · {suggestion.sourceChannelName}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SnapshotConflictDetails({ conflict }: { conflict: SnapshotConflict }) {
  return (
    <>
      <div className="mt-5 rounded-2xl border border-black/8 bg-black/2.5 p-4 dark:border-white/8 dark:bg-white/4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{conflict.name}</p>
            <p className="mt-1 truncate text-xs text-black/45 dark:text-white/45">
              {conflict.sourceEnvironmentName} · {conflict.sourceChannelName}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            Version {conflict.snapshotVersion}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
          {[
            ["Categories", conflict.categoryCount],
            ["Products", conflict.productCount],
            ["Variants", conflict.variantCount],
            ["Images", conflict.imageCount],
            ["Metafields", conflict.metafieldCount],
            ["Payload", formatBytes(conflict.payloadBytes)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-black/40 dark:text-white/40">{label}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 border-t border-black/8 pt-3 text-xs text-black/45 dark:border-white/8 dark:text-white/45">
          Created {dateFormatter.format(new Date(conflict.createdAt))} · Updated {dateFormatter.format(new Date(conflict.updatedAt))}
        </p>
      </div>
    </>
  );
}

export function SnapshotForm({
  environmentId,
  channelId,
  channelName,
  suggestions,
}: {
  environmentId: number;
  channelId: number;
  channelName: string;
  suggestions: SnapshotNameSuggestion[];
}) {
  const router = useRouter();
  const { t } = useAppI18n();
  const isActionInProgress = useCatalogOperationActive({ environmentId, channelId });
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [dismissedConflict, setDismissedConflict] = useState<string | null>(
    null,
  );
  const [state, formAction] = useActionState(createSnapshot, initialState);
  const [isRunning, setIsRunning] = useState(false);
  const operationStorageKey = CATALOG_OPERATION_KEY;
  const inputId = useId();
  const listboxId = useId();
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const conflictKey = state.conflict
    ? `${state.conflict.id}:${state.conflict.snapshotVersion}`
    : null;
  const isConfirmationOpen =
    state.status === "confirmation" &&
    state.conflict !== null &&
    dismissedConflict !== conflictKey;

  useEffect(() => {
    if (state.status === "success" && state.operationId) {
      startCatalogOperation({
        kind: "snapshot",
        environmentId,
        channelId,
        operationId: state.operationId,
        originPath: `/environments/${environmentId}/channels/${channelId}`,
      });
      queueMicrotask(() => setIsOpen(false));
      router.refresh();
    }
  }, [channelId, environmentId, router, state.operationId, state.status]);

  useEffect(() => {
    if (window.localStorage.getItem(operationStorageKey)) {
      const timer = window.setTimeout(() => setIsRunning(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, [operationStorageKey]);

  useEffect(() => {
    if (!isConfirmationOpen || !conflictKey) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const dismiss = () => setDismissedConflict(conflictKey);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        dismiss();
        return;
      }

      if (event.key === "Tab") {
        const focusableElements = modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
    confirmButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [conflictKey, isConfirmationOpen]);

  function handleMainSubmit(event: FormEvent<HTMLFormElement>) {
    if (
      state.status === "confirmation" &&
      state.conflict &&
      name.trim().toLocaleLowerCase() ===
        state.conflict.name.toLocaleLowerCase()
    ) {
      event.preventDefault();
      setDismissedConflict(null);
    }
  }

  return (
    <div className="w-full sm:w-auto">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="snapshot-name-panel"
        disabled={isActionInProgress}
        onClick={() => setIsOpen((current) => !current)}
        className="inline-flex h-6 w-full items-center justify-center gap-1 rounded-md border border-emerald-600/25 bg-emerald-500/10 px-2.5 text-[10px] leading-none font-semibold text-emerald-800 transition hover:bg-emerald-500/16 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 sm:w-auto dark:text-emerald-300"
      >
        <CameraIcon />
        {isOpen ? "Cancel snapshot" : "Take snapshot"}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm">
        <form
          id="snapshot-name-panel"
          action={formAction}
          onSubmit={handleMainSubmit}
          role="dialog"
          aria-modal="true"
          aria-labelledby="snapshot-name-title"
          className="w-full max-w-lg rounded-3xl border border-white/12 bg-white p-6 text-left shadow-2xl sm:p-7 dark:bg-neutral-950"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Catalog snapshot</p>
              <h2 id="snapshot-name-title" className="mt-1 text-2xl font-semibold">Take a snapshot</h2>
            </div>
            <button type="button" aria-label="Close snapshot dialog" onClick={() => setIsOpen(false)} className="grid size-9 place-items-center rounded-full border border-black/10 text-lg dark:border-white/10">×</button>
          </div>
          <input type="hidden" name="environmentId" value={environmentId} />
          <input type="hidden" name="channelId" value={channelId} />
          <label htmlFor={inputId} className="text-sm font-semibold">
            Snapshot name
          </label>
          <SnapshotNameCombobox
            inputId={inputId}
            listboxId={listboxId}
            placeholder={channelName}
            value={name}
            suggestions={suggestions}
            onChange={setName}
          />
          <p className="mt-2 text-xs leading-5 text-black/45 dark:text-white/45">
            Choose an existing name to create its next version, or enter a new
            name. Captures the full restoration-ready catalog; keep this page
            open until capture completes.
          </p>
          {state.status === "error" ? (
            <p role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">
              {t(state.message)}
            </p>
          ) : null}
          <div className="mt-4">
            <SubmitButton />
          </div>
        </form>
        </div>
      ) : null}


      {isConfirmationOpen && state.conflict ? (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && conflictKey) {
              setDismissedConflict(conflictKey);
            }
          }}
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm"
        >
          <section
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="snapshot-version-title"
            aria-describedby="snapshot-version-description"
            className="w-full max-w-lg rounded-3xl border border-white/12 bg-white p-6 shadow-2xl sm:p-7 dark:bg-neutral-950"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Existing snapshot
                </p>
                <h2
                  id="snapshot-version-title"
                  className="mt-1 text-2xl font-semibold tracking-[-0.03em]"
                >
                  Create a new version?
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close confirmation"
                onClick={() => {
                  if (conflictKey) {
                    setDismissedConflict(conflictKey);
                  }
                }}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-black/10 text-lg text-black/45 transition hover:bg-black/5 hover:text-black dark:border-white/10 dark:text-white/45 dark:hover:bg-white/8 dark:hover:text-white"
              >
                ×
              </button>
            </div>

            <p
              id="snapshot-version-description"
              className="mt-3 text-sm leading-6 text-black/55 dark:text-white/55"
            >
              This name already exists. The current capture will stay intact,
              and the new catalog will be saved as version {state.conflict.snapshotVersion + 1}.
            </p>

            <SnapshotConflictDetails conflict={state.conflict} />

            <form action={formAction} className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <input type="hidden" name="environmentId" value={environmentId} />
              <input type="hidden" name="channelId" value={channelId} />
              <input type="hidden" name="name" value={state.conflict.name} />
              <input
                type="hidden"
                name="confirmedSnapshotId"
                value={state.conflict.id}
              />
              <button
                type="button"
                onClick={() => {
                  if (conflictKey) {
                    setDismissedConflict(conflictKey);
                  }
                }}
                className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold transition hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/8"
              >
                Keep current only
              </button>
              <ConfirmVersionButton
                version={state.conflict.snapshotVersion + 1}
                buttonRef={confirmButtonRef}
              />
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
