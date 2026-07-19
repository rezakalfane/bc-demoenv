"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type OperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type OperationKind = "snapshot" | "restore" | "clear";

type OperationFeedItem = {
  id: number;
  kind: OperationKind;
  status: OperationStatus;
  environmentId: number | null;
  channelId: number | null;
  snapshotId: number | null;
  snapshotName: string | null;
  snapshotVersion: number | null;
  destinationEnvironmentName: string | null;
  destinationChannelName: string | null;
  currentStep: string;
  error: string | null;
  manualActionCount: number;
  updatedAt: string;
};

type OperationFeed = {
  generatedAt: string;
  operations: OperationFeedItem[];
};

type CompletionNotification = OperationFeedItem & {
  tone: "success" | "danger" | "attention";
  title: string;
  description: string;
  href: string | null;
  linkLabel: string | null;
};

const INITIAL_LOOKBACK_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

function notificationStorageKey(userId: string, suffix: string) {
  return `bc-demoenv:operation-notifications:${userId}:${suffix}`;
}

function readSeenIds(userId: string) {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(notificationStorageKey(userId, "seen")) || "[]",
    );
    return new Set<number>(
      Array.isArray(value) ? value.filter((id): id is number => typeof id === "number") : [],
    );
  } catch {
    return new Set<number>();
  }
}

function writeSeenIds(userId: string, seenIds: Set<number>) {
  try {
    window.localStorage.setItem(
      notificationStorageKey(userId, "seen"),
      JSON.stringify([...seenIds].slice(-100)),
    );
  } catch {
    // Notifications still work for the current page when storage is unavailable.
  }
}

function readLastCheckedAt(userId: string) {
  try {
    const stored = Number(
      window.localStorage.getItem(notificationStorageKey(userId, "checked-at")),
    );
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

function getNotificationLink(operation: OperationFeedItem) {
  if (operation.kind === "snapshot" && operation.snapshotId) {
    return { href: `/snapshots/${operation.snapshotId}`, label: "View snapshot" };
  }
  if (operation.environmentId && operation.channelId) {
    return {
      href: `/environments/${operation.environmentId}/channels/${operation.channelId}`,
      label: "View channel",
    };
  }
  if (operation.snapshotId) {
    return { href: `/snapshots/${operation.snapshotId}`, label: "View snapshot" };
  }
  return { href: null, label: null };
}

function toNotification(operation: OperationFeedItem): CompletionNotification {
  const target = operation.destinationChannelName
    ? [operation.destinationEnvironmentName, operation.destinationChannelName]
        .filter(Boolean)
        .join(" · ")
    : operation.snapshotName
      ? `${operation.snapshotName}${operation.snapshotVersion ? ` · version ${operation.snapshotVersion}` : ""}`
      : "the selected catalog";
  const link = getNotificationLink(operation);

  if (operation.status === "failed") {
    const titles: Record<OperationKind, string> = {
      snapshot: "Snapshot capture failed",
      restore: "Snapshot restore failed",
      clear: "Catalog clear failed",
    };
    return {
      ...operation,
      tone: "danger",
      title: titles[operation.kind],
      description: operation.error || operation.currentStep || `The operation for ${target} failed.`,
      href: link.href,
      linkLabel: link.label,
    };
  }

  if (operation.manualActionCount > 0) {
    return {
      ...operation,
      tone: "attention",
      title: "Restore needs manual action",
      description: `${operation.manualActionCount} manual action${operation.manualActionCount === 1 ? "" : "s"} remain for ${target}. Open the channel to review History.`,
      href: link.href,
      linkLabel: link.label,
    };
  }

  const titles: Record<OperationKind, string> = {
    snapshot: "Snapshot captured",
    restore: "Snapshot restored",
    clear: "Catalog cleared",
  };
  return {
    ...operation,
    tone: "success",
    title: titles[operation.kind],
    description: `${target} is ready.`,
    href: link.href,
    linkLabel: link.label,
  };
}

function StatusIcon({ tone }: { tone: CompletionNotification["tone"] }) {
  if (tone === "danger") {
    return <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 9v4m0 4h.01" /><circle cx="12" cy="12" r="9" /></svg>;
  }
  if (tone === "attention") {
    return <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 8v5m0 4h.01" /><path d="M10.3 3.7 2.5 17.2A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.8L13.7 3.7a2 2 0 0 0-3.4 0Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m7 12 3 3 7-7" /><circle cx="12" cy="12" r="9" /></svg>;
}

export function CatalogOperationNotifications({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<CompletionNotification[]>([]);
  const observedActiveIds = useRef(new Set<number>());
  const seenIds = useRef<Set<number> | null>(null);
  const lastCheckedAt = useRef<number | null>(null);
  const polling = useRef(false);
  const disposed = useRef(false);

  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const response = await fetch("/api/catalog-operations", { cache: "no-store" });
      if (!response.ok) throw new Error("The catalog operation feed is unavailable.");
      if (disposed.current) return;
      const feed = await response.json() as OperationFeed;
      const now = Date.parse(feed.generatedAt) || Date.now();
      if (!seenIds.current) seenIds.current = readSeenIds(userId);
      if (lastCheckedAt.current === null) {
        lastCheckedAt.current = readLastCheckedAt(userId) ?? now - INITIAL_LOOKBACK_MS;
      }

      const nextNotifications: CompletionNotification[] = [];
      for (const operation of feed.operations) {
        if (operation.status === "queued" || operation.status === "running") {
          observedActiveIds.current.add(operation.id);
          continue;
        }
        if (operation.status !== "completed" && operation.status !== "failed") continue;
        if (seenIds.current.has(operation.id)) continue;

        const updatedAt = Date.parse(operation.updatedAt);
        const becameTerminalWhileObserved = observedActiveIds.current.has(operation.id);
        if (!becameTerminalWhileObserved && updatedAt <= lastCheckedAt.current) continue;

        seenIds.current.add(operation.id);
        observedActiveIds.current.delete(operation.id);
        nextNotifications.push(toNotification(operation));
      }

      if (nextNotifications.length > 0) {
        writeSeenIds(userId, seenIds.current);
        setNotifications((current) => [
          ...nextNotifications,
          ...current.filter((item) => !nextNotifications.some((next) => next.id === item.id)),
        ].slice(0, 5));
      }
      lastCheckedAt.current = now;
      try {
        window.localStorage.setItem(
          notificationStorageKey(userId, "checked-at"),
          String(now),
        );
      } catch {
        // The in-memory timestamp still prevents duplicate notifications.
      }
    } catch {
      // A later interval or visibility change retries transient feed failures.
    } finally {
      polling.current = false;
    }
  }, [userId]);

  useEffect(() => {
    disposed.current = false;
    const initialPoll = window.setTimeout(() => { void poll(); }, 0);
    const pollNow = () => {
      void poll();
    };
    const onVisibilityChange = () => {
      if (!document.hidden) pollNow();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === "bc-demoenv:catalog-operation") pollNow();
    };
    const interval = window.setInterval(() => {
      if (!document.hidden) void poll();
    }, POLL_INTERVAL_MS);
    window.addEventListener("catalog-operation-change", pollNow);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed.current = true;
      window.clearTimeout(initialPoll);
      window.clearInterval(interval);
      window.removeEventListener("catalog-operation-change", pollNow);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [poll]);

  if (notifications.length === 0) return null;

  return (
    <aside
      className="pointer-events-none fixed top-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3"
      aria-label="Catalog operation notifications"
      aria-live="polite"
    >
      {notifications.map((notification) => {
        const styles = notification.tone === "danger"
          ? "border-red-500/35 bg-red-950 text-red-50"
          : notification.tone === "attention"
            ? "border-amber-400/35 bg-amber-950 text-amber-50"
            : "border-emerald-400/35 bg-emerald-950 text-emerald-50";
        return (
          <div
            key={notification.id}
            className={`pointer-events-auto rounded-2xl border p-4 shadow-2xl shadow-black/30 ${styles}`}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0"><StatusIcon tone={notification.tone} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{notification.title}</p>
                <p className="mt-1 line-clamp-3 text-xs leading-5 text-current/70">
                  {notification.description}
                </p>
                {notification.href && notification.linkLabel ? (
                  <Link
                    href={notification.href}
                    onClick={() => setNotifications((current) => current.filter((item) => item.id !== notification.id))}
                    className="mt-3 inline-flex rounded-lg border border-current/25 px-2.5 py-1.5 text-xs font-semibold transition hover:bg-white/10"
                  >
                    {notification.linkLabel} →
                  </Link>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setNotifications((current) => current.filter((item) => item.id !== notification.id))}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-current/65 transition hover:bg-white/10 hover:text-current"
                aria-label={`Dismiss ${notification.title}`}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
