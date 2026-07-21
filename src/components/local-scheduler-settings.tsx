"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateLocalSchedulerEnabled } from "@/app/(app)/settings/profile/actions";

export function LocalSchedulerSettings({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function update(nextEnabled: boolean) {
    setMessage("");
    setEnabled(nextEnabled);
    startTransition(async () => {
      const result = await updateLocalSchedulerEnabled(nextEnabled);
      if (result.status === "error") setEnabled(!nextEnabled);
      setMessage(result.message);
      if (result.status === "success") router.refresh();
    });
  }

  return (
    <section className="rounded-3xl border border-black/10 bg-white/65 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.04)] sm:p-7 dark:border-white/10 dark:bg-white/4">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">Local scheduler</h3>
            <span className="rounded-full bg-amber-500/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              Dev only
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-black/45 dark:text-white/45">
            Check your schedules from this browser every minute. Disable this when
            Vercel Cron or another development browser is dispatching the same
            schedules; database claims still prevent duplicate executions.
          </p>
        </div>

        <label className="flex shrink-0 cursor-pointer items-center gap-3 rounded-2xl border border-black/10 px-4 py-3 dark:border-white/10">
          <span className="text-sm font-semibold">
            {enabled ? "Enabled" : "Disabled"}
          </span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(event) => update(event.target.checked)}
            className="peer sr-only"
          />
          <span className={`relative h-6 w-11 rounded-full transition peer-disabled:opacity-50 ${enabled ? "bg-emerald-500" : "bg-black/15 dark:bg-white/15"}`}>
            <span className={`absolute left-1 top-1 size-4 rounded-full bg-white shadow-sm transition ${enabled ? "translate-x-5" : "translate-x-0"}`} />
          </span>
        </label>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-black/8 p-4 dark:border-white/8">
          <p className="text-xs uppercase tracking-[0.14em] text-black/40 dark:text-white/40">Interval</p>
          <p className="mt-2 text-sm font-semibold">Every minute</p>
        </div>
        <div className="rounded-2xl border border-black/8 p-4 dark:border-white/8">
          <p className="text-xs uppercase tracking-[0.14em] text-black/40 dark:text-white/40">Scope</p>
          <p className="mt-2 text-sm font-semibold">Your schedules</p>
        </div>
        <div className="rounded-2xl border border-black/8 p-4 dark:border-white/8">
          <p className="text-xs uppercase tracking-[0.14em] text-black/40 dark:text-white/40">Dispatcher</p>
          <p className="mt-2 text-sm font-semibold">This browser session</p>
        </div>
      </div>

      <p
        role="status"
        className={`mt-4 min-h-5 text-sm ${message.startsWith("The local scheduler is available") ? "text-red-600 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}
      >
        {pending ? "Updating scheduler preference…" : message}
      </p>
    </section>
  );
}
