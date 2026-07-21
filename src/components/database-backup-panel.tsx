"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";
import { useConfirmation } from "@/components/confirmation-provider";

function ArchiveIcon({ action }: { action: "backup" | "restore" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={action === "backup" ? "M12 10v7m0 0 3-3m-3 3-3-3" : "M12 18v-7m0 0 3 3m-3-3-3 3"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DatabaseBackupPanel({
  activeDatabase,
  authorized,
}: {
  activeDatabase: "local" | "remote";
  authorized: boolean;
}) {
  const confirm = useConfirmation();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<"backup" | "restore" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const databaseLabel = activeDatabase === "local" ? "local SQLite" : "Turso";

  async function downloadBackup() {
    setMessage(null);
    setPending("backup");
    try {
      const response = await fetch("/api/database-backup", { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "The database backup failed.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "bc-demoenv-database-backup.json";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setMessage({ tone: "success", text: `A complete ${databaseLabel} backup was downloaded.` });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The database backup failed." });
    } finally {
      setPending(null);
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const accepted = await confirm({
      title: `Replace ${databaseLabel} from this backup?`,
      description: `This completely replaces every application table in ${databaseLabel} with ${file.name}, including all users' data. Current data will be lost. Active catalog workflows block the restore.`,
      confirmLabel: "Restore whole database",
      tone: "danger",
    });
    if (!accepted) return;

    setMessage(null);
    setPending("restore");
    try {
      const text = await file.text();
      JSON.parse(text);
      const response = await fetch("/api/database-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        rowCount?: number;
        tableCount?: number;
        skippedRowCount?: number;
      };
      if (!response.ok) throw new Error(body.error ?? "The database restore failed.");
      const skipped = Number(body.skippedRowCount ?? 0);
      setMessage({
        tone: "success",
        text: `Restored ${Number(body.rowCount ?? 0).toLocaleString("en-US")} rows across ${Number(body.tableCount ?? 0)} tables${skipped ? `; skipped ${skipped} legacy ownerless note${skipped === 1 ? "" : "s"}` : ""}.`,
      });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The database restore failed." });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="rounded-3xl border border-black/10 bg-white/65 p-5 shadow-[0_16px_50px_rgba(0,0,0,0.04)] sm:p-7 dark:border-white/10 dark:bg-white/4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">Whole database backup</h3>
            <span className="rounded-full bg-blue-500/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              {activeDatabase === "local" ? "Local SQLite" : "Turso"}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-black/45 dark:text-white/45">
            Download or transactionally restore every application table in the active database. The file contains encrypted credentials and every tenant&apos;s data; handle it as a secret.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!authorized || pending !== null} onClick={() => void downloadBackup()} className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-500/8 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-300">
            <ArchiveIcon action="backup" /> {pending === "backup" ? "Preparing…" : "Download backup"}
          </button>
          <button type="button" disabled={!authorized || pending !== null} onClick={() => input.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-500/8 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300">
            <ArchiveIcon action="restore" /> {pending === "restore" ? "Restoring…" : "Restore backup"}
          </button>
          <input ref={input} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void restoreBackup(event)} />
        </div>
      </div>

      {!authorized ? (
        <p className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm leading-6 text-amber-800 dark:text-amber-200">
          Add your email to <code className="font-mono">DATABASE_BACKUP_ALLOWED_EMAILS</code> to enable these controls in production.
        </p>
      ) : null}
      <p role="status" className={`mt-4 min-h-5 text-sm ${message?.tone === "error" ? "text-red-600 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
        {pending === "backup" ? `Preparing the ${databaseLabel} backup…` : pending === "restore" ? `Restoring ${databaseLabel}…` : message?.text ?? ""}
      </p>
    </div>
  );
}
