"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  clearCatalog,
  type ClearCatalogActionState,
} from "@/app/(app)/environments/[environmentId]/channels/[channelId]/actions";
import { finishCatalogOperation, startCatalogOperation, useCatalogOperationActive } from "@/components/catalog-operation-progress";
import { TrashIcon } from "@/components/action-icons";

const initialState: ClearCatalogActionState = {
  status: "idle",
  message: "",
  result: null,
};

function SubmitButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={!enabled || pending}
      className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {pending ? "Clearing…" : "Clear catalog"}
    </button>
  );
}

export function ClearCatalog({ environmentId, channelId, channelName }: {
  environmentId: number;
  channelId: number;
  channelName: string;
  stepNames?: string[];
}) {
  const router = useRouter();
  const isActionInProgress = useCatalogOperationActive({ environmentId, channelId });
  const [isOpen, setIsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [state, formAction] = useActionState(clearCatalog, initialState);
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      if (state.operationId) {
        startCatalogOperation({ kind: "clear", environmentId, channelId, operationId: state.operationId });
      }
      queueMicrotask(() => {
        setIsOpen(false);
      });
      router.refresh();
    } else if (state.status === "error") {
      finishCatalogOperation();
      queueMicrotask(() => {
        setIsOpen(true);
      });
    }
  }, [channelId, environmentId, router, state.operationId, state.status]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        disabled={isActionInProgress}
        onClick={() => { setConfirmation(""); setIsOpen(true); }}
        className="inline-flex items-center justify-center gap-1 rounded border border-red-500/30 bg-red-500/8 px-2 py-1 text-[10px] leading-none font-semibold text-red-800 transition hover:bg-red-500/14 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-200"
      >
        <TrashIcon />
        Clear catalog
      </button>
      {isOpen ? (
        <div
          role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
        >
          <section ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="clear-catalog-title" className="w-full max-w-lg rounded-3xl border border-white/12 bg-white p-6 shadow-2xl dark:bg-neutral-950">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-300">Destructive channel action</p>
                <h2 id="clear-catalog-title" className="mt-1 text-2xl font-semibold">Clear {channelName}?</h2>
              </div>
              <button ref={closeRef} type="button" aria-label="Close" onClick={() => setIsOpen(false)} className="grid size-9 place-items-center rounded-full border border-black/10 text-lg dark:border-white/10">×</button>
            </div>
            <p className="mt-4 text-sm leading-6 text-black/60 dark:text-white/60">This removes the channel’s category tree contents and unassigns products from this channel. Products are not deleted and remain available to other channels.</p>
            {state.status === "error" ? <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-800 dark:text-red-200">{state.message}</p> : null}
            {state.status === "success" && state.result ? <p role="status" className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">{state.message} {state.result.productsUnassigned} products unassigned and {state.result.categoriesRemoved} categories removed.</p> : null}
            {state.status !== "success" ? (
              <form action={formAction} className="mt-5">
                <input type="hidden" name="environmentId" value={environmentId} />
                <input type="hidden" name="channelId" value={channelId} />
                <label htmlFor="clear-confirmation" className="text-sm font-medium">Type <span className="font-mono">CLEAR</span> to confirm</label>
                <input id="clear-confirmation" name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-black/12 bg-transparent px-3 py-2.5 font-mono text-sm outline-none focus:border-red-500 dark:border-white/12" />
                <div className="mt-5 flex justify-end gap-3 border-t border-black/8 pt-5 dark:border-white/8"><button type="button" onClick={() => setIsOpen(false)} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold dark:border-white/10">Cancel</button><SubmitButton enabled={confirmation === "CLEAR"} /></div>
              </form>
            ) : <div className="mt-5 flex justify-end"><button type="button" onClick={() => setIsOpen(false)} className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-neutral-950">Close</button></div>}
          </section>
        </div>
      ) : null}
    </>
  );
}
