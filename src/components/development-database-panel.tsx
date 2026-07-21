"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  pullTursoIntoLocalDatabase,
  pushLocalDatabaseToTurso,
  type DatabaseSyncActionResult,
} from "@/app/(app)/settings/profile/actions";
import { useConfirmation } from "@/components/confirmation-provider";
import type { DevelopmentDatabaseStatus } from "@/lib/db";

function SyncIcon({ direction }: { direction: "pull" | "push" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d={direction === "pull" ? "M12 3v13m0 0 5-5m-5 5-5-5M5 21h14" : "M12 21V8m0 0 5 5m-5-5-5 5M5 3h14"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DevelopmentDatabasePanel({ status }: { status: DevelopmentDatabaseStatus }) {
  const confirm = useConfirmation();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DatabaseSyncActionResult | null>(null);

  function run(direction: "pull" | "push") {
    void (async () => {
      const pulling = direction === "pull";
      const accepted = await confirm({
        title: pulling ? "Replace local SQLite from Turso?" : "Replace Turso from local SQLite?",
        description: pulling
          ? "This replaces every application table in your local development database with the current Turso data. Local-only changes will be lost. Active catalog workflows block the sync."
          : "This replaces every application table in Turso with your local development data and affects every application user. Remote-only changes will be lost. Active catalog workflows block the sync.",
        confirmLabel: pulling ? "Pull from Turso" : "Push to Turso",
        tone: pulling ? "primary" : "danger",
      });
      if (!accepted) return;

      setResult(null);
      startTransition(async () => {
        const response = pulling
          ? await pullTursoIntoLocalDatabase()
          : await pushLocalDatabaseToTurso();
        setResult(response);
        if (response.status === "success") router.refresh();
      });
    })();
  }

  return (
    <section id="database" className="scroll-mt-8 rounded-3xl border border-black/10 bg-white/65 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.04)] sm:p-7 dark:border-white/10 dark:bg-white/4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Development database</h2>
            <span className="rounded-full bg-amber-500/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Dev only</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-black/45 dark:text-white/45">
            Work against a local SQLite file, then explicitly mirror the complete application database in either direction. Sync is never automatic.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${status.enabled ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-black/5 text-black/50 dark:bg-white/8 dark:text-white/50"}`}>
          {status.enabled ? "Local mirror enabled" : "Not configured"}
        </span>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-black/40 dark:text-white/40">Active development DB</p>
          <p className="mt-2 font-mono text-sm">{status.activeDatabase === "local" ? status.localUrl ?? "file:local.db" : "Turso"}</p>
        </div>
        <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-black/40 dark:text-white/40">Remote mirror</p>
          <p className="mt-2 text-sm font-medium">{status.remoteConfigured ? "Turso configured" : "Turso is not configured"}</p>
        </div>
      </div>

      {!status.enabled ? (
        <p className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm leading-6 text-amber-800 dark:text-amber-200">
          Set <code className="font-mono">LOCAL_DATABASE_URL=file:local.db</code> alongside your Turso variables, then restart the dev server.
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-black/10 pt-5 dark:border-white/10">
        <p role="status" className={`min-h-5 text-sm ${result?.status === "error" ? "text-red-600 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
          {pending ? "Synchronizing databases… Keep this dev server running." : result?.message ?? ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!status.enabled || pending} onClick={() => run("pull")} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-500/8 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300">
            <SyncIcon direction="pull" /> Pull from Turso
          </button>
          <button type="button" disabled={!status.enabled || pending} onClick={() => run("push")} className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-500/8 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300">
            <SyncIcon direction="push" /> Push to Turso
          </button>
        </div>
      </div>
    </section>
  );
}
