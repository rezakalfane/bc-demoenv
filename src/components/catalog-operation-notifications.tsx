"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  finishCatalogOperation,
  readCatalogOperation,
} from "@/components/catalog-operation-progress";

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
  expiresAt: number;
};

type PanelPosition = {
  top: number;
  left: number;
  width: number;
};

const INITIAL_LOOKBACK_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;
const NOTIFICATION_TIMEOUT_MS = 30_000;
const MAX_INBOX_NOTIFICATIONS = 50;

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

function readInbox(userId: string) {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(notificationStorageKey(userId, "inbox")) || "[]",
    );
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is CompletionNotification => (
      typeof item === "object"
      && item !== null
      && typeof item.id === "number"
      && typeof item.title === "string"
      && typeof item.description === "string"
      && (item.tone === "success" || item.tone === "danger" || item.tone === "attention")
    )).slice(0, MAX_INBOX_NOTIFICATIONS);
  } catch {
    return [];
  }
}

function writeInbox(userId: string, notifications: CompletionNotification[]) {
  try {
    window.localStorage.setItem(
      notificationStorageKey(userId, "inbox"),
      JSON.stringify(notifications.slice(0, MAX_INBOX_NOTIFICATIONS)),
    );
  } catch {
    // The current tab retains its in-memory inbox when storage is unavailable.
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

function toNotification(operation: OperationFeedItem, shownAt: number): CompletionNotification {
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
      expiresAt: shownAt + NOTIFICATION_TIMEOUT_MS,
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
      expiresAt: shownAt + NOTIFICATION_TIMEOUT_MS,
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
    expiresAt: shownAt + NOTIFICATION_TIMEOUT_MS,
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

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

function notificationStyles(tone: CompletionNotification["tone"], compact = false) {
  if (tone === "danger") {
    return compact
      ? "border-red-500/20 bg-red-500/7 text-red-800 dark:text-red-200"
      : "border-red-500/35 bg-red-950 text-red-50";
  }
  if (tone === "attention") {
    return compact
      ? "border-amber-500/20 bg-amber-500/7 text-amber-800 dark:text-amber-200"
      : "border-amber-400/35 bg-amber-950 text-amber-50";
  }
  return compact
    ? "border-emerald-500/20 bg-emerald-500/7 text-emerald-800 dark:text-emerald-200"
    : "border-emerald-400/35 bg-emerald-950 text-emerald-50";
}

export function CatalogOperationNotifications({ userId }: { userId: string }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<CompletionNotification[]>([]);
  const [toastNotifications, setToastNotifications] = useState<CompletionNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<PanelPosition>({ top: 80, left: 16, width: 352 });
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const observedActiveIds = useRef(new Set<number>());
  const seenIds = useRef<Set<number> | null>(null);
  const lastCheckedAt = useRef<number | null>(null);
  const polling = useRef(false);
  const disposed = useRef(false);
  const centerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const getPanelPosition = useCallback((): PanelPosition => {
    const rect = centerRef.current?.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const mobile = viewportWidth < 1024;
    const width = mobile ? Math.max(viewportWidth - 32, 0) : Math.min(352, viewportWidth - 32);
    const preferredLeft = mobile ? 16 : (rect?.right ?? 16) + 12;
    return {
      top: Math.max(16, (rect?.bottom ?? 68) + 12),
      left: Math.max(16, Math.min(preferredLeft, viewportWidth - width - 16)),
      width,
    };
  }, []);

  const removeNotification = useCallback((notificationId: number) => {
    setNotifications((current) => current.filter((item) => item.id !== notificationId));
    setToastNotifications((current) => current.filter((item) => item.id !== notificationId));
  }, []);

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
      let finishedLocalOperationId: number | null = null;
      const localOperation = readCatalogOperation();
      for (const operation of feed.operations) {
        if (operation.status === "queued" || operation.status === "running") {
          observedActiveIds.current.add(operation.id);
          continue;
        }
        if (
          localOperation?.operationId === operation.id
          && (operation.status === "completed"
            || operation.status === "failed"
            || operation.status === "cancelled")
        ) {
          finishedLocalOperationId = operation.id;
        }
        if (operation.status !== "completed" && operation.status !== "failed") continue;
        if (seenIds.current.has(operation.id)) continue;

        const updatedAt = Date.parse(operation.updatedAt);
        const becameTerminalWhileObserved = observedActiveIds.current.has(operation.id);
        if (!becameTerminalWhileObserved && updatedAt <= lastCheckedAt.current) continue;

        seenIds.current.add(operation.id);
        observedActiveIds.current.delete(operation.id);
        nextNotifications.push(toNotification(operation, now));
      }

      if (
        finishedLocalOperationId !== null
        && finishCatalogOperation(finishedLocalOperationId)
      ) {
        router.refresh();
      }

      if (nextNotifications.length > 0) {
        writeSeenIds(userId, seenIds.current);
        setNotifications((current) => [
          ...nextNotifications,
          ...current.filter((item) => !nextNotifications.some((next) => next.id === item.id)),
        ].slice(0, MAX_INBOX_NOTIFICATIONS));
        setToastNotifications((current) => [
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
  }, [router, userId]);

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

  useEffect(() => {
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      setNotifications(readInbox(userId));
      setInboxLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!inboxLoaded) return;
    writeInbox(userId, notifications);
  }, [inboxLoaded, notifications, userId]);

  useEffect(() => {
    const inboxKey = notificationStorageKey(userId, "inbox");
    const onStorage = (event: StorageEvent) => {
      if (event.key === inboxKey) setNotifications(readInbox(userId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!centerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => setPanelPosition(getPanelPosition());
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [getPanelPosition, isOpen]);

  useEffect(() => {
    if (toastNotifications.length === 0) return;
    const now = Date.now();
    const nextExpiry = Math.min(...toastNotifications.map((notification) => notification.expiresAt));
    const timeout = window.setTimeout(() => {
      const expiredAt = Date.now();
      setToastNotifications((current) => current.filter(
        (notification) => notification.expiresAt > expiredAt,
      ));
    }, Math.max(nextExpiry - now, 0));
    return () => window.clearTimeout(timeout);
  }, [toastNotifications]);

  return (
    <>
      <div ref={centerRef} className="notification-center relative shrink-0">
        <button
          type="button"
          aria-label={`Notifications${notifications.length > 0 ? `, ${notifications.length} awaiting deletion` : ""}`}
          aria-expanded={isOpen}
          aria-controls="notification-center-panel"
          title="Notifications"
          onClick={() => {
            if (!isOpen) setPanelPosition(getPanelPosition());
            setIsOpen((current) => !current);
          }}
          className="relative flex size-8 items-center justify-center rounded-xl border border-black/8 bg-white/55 text-black/50 transition hover:border-emerald-500/30 hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-white/8 dark:bg-white/5 dark:text-white/50 dark:hover:text-emerald-300"
        >
          <BellIcon />
          {notifications.length > 0 ? (
            <span className="absolute -top-1.5 -right-1.5 flex min-w-4.5 items-center justify-center rounded-full border-2 border-background bg-red-500 px-1 text-[9px] leading-3.5 font-bold text-white tabular-nums">
              {notifications.length > 99 ? "99+" : notifications.length}
            </span>
          ) : null}
        </button>

      </div>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
          <section
            ref={panelRef}
            id="notification-center-panel"
            role="dialog"
            aria-label="Notifications"
            style={panelPosition}
            className="fixed z-[120] overflow-hidden rounded-2xl border border-black/10 bg-background shadow-2xl shadow-black/25 dark:border-white/10"
          >
            <div className="flex items-center justify-between gap-3 border-b border-black/8 px-4 py-3 dark:border-white/8">
              <div>
                <p className="text-sm font-semibold">Notifications</p>
                <p className="text-[11px] text-black/45 dark:text-white/45">
                  {notifications.length === 0 ? "Nothing awaiting deletion" : `${notifications.length} awaiting deletion`}
                </p>
              </div>
              {notifications.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setNotifications([]);
                    setToastNotifications([]);
                  }}
                  className="rounded-md border border-black/10 px-2.5 py-1 text-[10px] font-semibold text-black/55 transition hover:bg-black/5 hover:text-black dark:border-white/10 dark:text-white/55 dark:hover:bg-white/8 dark:hover:text-white"
                >
                  Delete all
                </button>
              ) : null}
            </div>

            {notifications.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <span className="mx-auto flex size-9 items-center justify-center rounded-full bg-black/5 text-black/35 dark:bg-white/6 dark:text-white/35"><BellIcon /></span>
                <p className="mt-3 text-xs text-black/45 dark:text-white/45">New operation results will appear here.</p>
              </div>
            ) : (
              <div className="max-h-[min(28rem,calc(100vh-8rem))] overflow-y-auto p-2">
                {notifications.map((notification) => (
                  <article key={notification.id} className={`mb-2 rounded-xl border p-3 last:mb-0 ${notificationStyles(notification.tone, true)}`}>
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 shrink-0"><StatusIcon tone={notification.tone} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">{notification.title}</p>
                        <p className="mt-1 line-clamp-3 text-[11px] leading-4 text-current/65">{notification.description}</p>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <time dateTime={notification.updatedAt} className="text-[10px] text-current/50">
                            {new Date(notification.updatedAt).toLocaleString()}
                          </time>
                          {notification.href && notification.linkLabel ? (
                            <Link href={notification.href} onClick={() => setIsOpen(false)} className="shrink-0 text-[10px] font-semibold hover:underline">
                              {notification.linkLabel} →
                            </Link>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeNotification(notification.id)}
                        className="flex size-6 shrink-0 items-center justify-center rounded-full text-current/50 transition hover:bg-black/6 hover:text-current dark:hover:bg-white/8"
                        aria-label={`Delete ${notification.title}`}
                        title="Delete notification"
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>,
          document.body,
        )
        : null}

      {toastNotifications.length > 0 && typeof document !== "undefined"
        ? createPortal(
          <aside
            className="pointer-events-none fixed top-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3"
            aria-label="Catalog operation notification popups"
            aria-live="polite"
          >
            {toastNotifications.map((notification) => (
              <div key={notification.id} className={`pointer-events-auto rounded-2xl border p-4 shadow-2xl shadow-black/30 ${notificationStyles(notification.tone)}`}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0"><StatusIcon tone={notification.tone} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{notification.title}</p>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-current/70">{notification.description}</p>
                    {notification.href && notification.linkLabel ? (
                      <Link href={notification.href} onClick={() => setToastNotifications((current) => current.filter((item) => item.id !== notification.id))} className="mt-3 inline-flex rounded-lg border border-current/25 px-2.5 py-1.5 text-xs font-semibold transition hover:bg-white/10">
                        {notification.linkLabel} →
                      </Link>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setToastNotifications((current) => current.filter((item) => item.id !== notification.id))}
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-current/65 transition hover:bg-white/10 hover:text-current"
                    aria-label={`Dismiss ${notification.title} popup`}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
              </div>
            ))}
          </aside>,
          document.body,
        )
        : null}
    </>
  );
}
