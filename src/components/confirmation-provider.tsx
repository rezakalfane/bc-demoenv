"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ConfirmationTone = "danger" | "primary";

type ConfirmationOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmationTone;
};

type ConfirmationContextValue = (options: ConfirmationOptions) => Promise<boolean>;

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmationOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const confirm = useCallback((options: ConfirmationOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setPending(options);
    });
  }, []);

  const finish = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolve?.(confirmed);
  }, []);

  useEffect(() => {
    if (!pending) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(false);
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [finish, pending]);

  useEffect(() => {
    return () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

  return (
    <ConfirmationContext.Provider value={confirm}>
      {children}
      {pending && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[500] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) finish(false);
              }}
            >
              <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirmation-title"
                aria-describedby="confirmation-description"
                className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/12 bg-[#0d100e] text-white shadow-2xl"
              >
                <div className="flex items-start gap-4 p-6 sm:p-7">
                  <span
                    aria-hidden="true"
                    className={`grid size-11 shrink-0 place-items-center rounded-full border text-xl ${
                      pending.tone === "primary"
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-red-500/30 bg-red-500/10 text-red-300"
                    }`}
                  >
                    {pending.tone === "primary" ? "↻" : "!"}
                  </span>
                  <div className="min-w-0">
                    <h2 id="confirmation-title" className="text-xl font-semibold tracking-tight">
                      {pending.title}
                    </h2>
                    <p id="confirmation-description" className="mt-2 text-sm leading-6 text-white/55">
                      {pending.description}
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 border-t border-white/10 px-6 py-4 sm:px-7">
                  <button
                    ref={cancelButtonRef}
                    type="button"
                    onClick={() => finish(false)}
                    className="rounded-xl border border-white/12 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/6 focus:outline-none focus:ring-2 focus:ring-white/20"
                  >
                    {pending.cancelLabel ?? "Cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={() => finish(true)}
                    className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 ${
                      pending.tone === "primary"
                        ? "bg-emerald-500 text-[#07120d] hover:bg-emerald-400 focus:ring-emerald-400/40"
                        : "bg-red-600 text-white hover:bg-red-500 focus:ring-red-500/40"
                    }`}
                  >
                    {pending.confirmLabel ?? "Confirm"}
                  </button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation() {
  const confirmation = useContext(ConfirmationContext);
  if (!confirmation) throw new Error("useConfirmation must be used inside ConfirmationProvider.");
  return confirmation;
}
