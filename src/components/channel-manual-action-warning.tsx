"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CATALOG_OPERATION_NOTIFICATIONS_CHANGED,
  catalogOperationNotificationStorageKey,
  readCatalogOperationNotificationInbox,
  removeCatalogOperationNotification,
  type StoredCatalogOperationNotification,
} from "@/lib/catalog-operation-notifications";

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 8v5m0 4h.01" />
      <path d="M10.3 3.7 2.5 17.2A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.8L13.7 3.7a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

export function ChannelManualActionWarning({
  userId,
  environmentId,
  channelId,
}: {
  userId: string;
  environmentId: number;
  channelId: number;
}) {
  const [notification, setNotification] = useState<StoredCatalogOperationNotification | null>(null);

  const syncNotification = useCallback(() => {
    const match = readCatalogOperationNotificationInbox(userId).find((item) => (
      item.tone === "attention"
      && (item.kind === "restore" || item.kind === "refresh")
      && item.environmentId === environmentId
      && item.channelId === channelId
    ));
    setNotification(match ?? null);
  }, [channelId, environmentId, userId]);

  useEffect(() => {
    window.queueMicrotask(syncNotification);
    const inboxKey = catalogOperationNotificationStorageKey(userId, "inbox");
    const onStorage = (event: StorageEvent) => {
      if (event.key === inboxKey) syncNotification();
    };
    const onNotificationsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string }>).detail;
      if (!detail?.userId || detail.userId === userId) syncNotification();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(
      CATALOG_OPERATION_NOTIFICATIONS_CHANGED,
      onNotificationsChanged,
    );
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        CATALOG_OPERATION_NOTIFICATIONS_CHANGED,
        onNotificationsChanged,
      );
    };
  }, [syncNotification, userId]);

  if (!notification) return null;

  return (
    <section
      role="alert"
      className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3.5 py-3 text-amber-900 dark:text-amber-100"
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/12">
        <WarningIcon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">Restore needs manual action</p>
        <p className="mt-1 text-[11px] leading-4 text-current/65">
          {notification.description}
        </p>
        {notification.href && notification.linkLabel ? (
          <a
            href={notification.href}
            target={/^https?:\/\//i.test(notification.href) ? "_blank" : undefined}
            rel={/^https?:\/\//i.test(notification.href) ? "noreferrer" : undefined}
            className="mt-2 inline-flex text-[11px] font-semibold hover:underline"
          >
            {notification.linkLabel} →
          </a>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => removeCatalogOperationNotification(userId, notification.id)}
        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-current/55 transition hover:bg-amber-500/12 hover:text-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
        aria-label="Dismiss manual action warning and delete its notification"
        title="Dismiss and delete notification"
      >
        <span aria-hidden="true">×</span>
      </button>
    </section>
  );
}
