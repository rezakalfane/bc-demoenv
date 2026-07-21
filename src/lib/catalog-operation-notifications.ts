export type StoredCatalogOperationNotification = {
  id: number;
  kind: "snapshot" | "restore" | "clear" | "refresh" | "database_sync";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
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
  manualAction?: {
    label: string;
    description: string;
    href: string;
  } | null;
  updatedAt: string;
  tone: "success" | "danger" | "attention";
  title: string;
  description: string;
  href: string | null;
  linkLabel: string | null;
  expiresAt: number;
};

export const CATALOG_OPERATION_NOTIFICATIONS_CHANGED =
  "catalog-operation-notifications-change";

export const MAX_CATALOG_OPERATION_NOTIFICATIONS = 50;

export function catalogOperationNotificationStorageKey(
  userId: string,
  suffix: string,
) {
  return `bc-demoenv:operation-notifications:${userId}:${suffix}`;
}

export function readCatalogOperationNotificationInbox(userId: string) {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(
        catalogOperationNotificationStorageKey(userId, "inbox"),
      ) || "[]",
    );
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is StoredCatalogOperationNotification => (
      typeof item === "object"
      && item !== null
      && typeof item.id === "number"
      && typeof item.title === "string"
      && typeof item.description === "string"
      && (item.tone === "success" || item.tone === "danger" || item.tone === "attention")
    )).slice(0, MAX_CATALOG_OPERATION_NOTIFICATIONS);
  } catch {
    return [];
  }
}

export function writeCatalogOperationNotificationInbox(
  userId: string,
  notifications: StoredCatalogOperationNotification[],
) {
  try {
    window.localStorage.setItem(
      catalogOperationNotificationStorageKey(userId, "inbox"),
      JSON.stringify(notifications.slice(0, MAX_CATALOG_OPERATION_NOTIFICATIONS)),
    );
  } catch {
    // Notification state remains available in memory when storage is unavailable.
  }
}

export function broadcastCatalogOperationNotificationsChanged(
  userId: string,
  source: "center" | "external" = "external",
) {
  window.dispatchEvent(new CustomEvent(CATALOG_OPERATION_NOTIFICATIONS_CHANGED, {
    detail: { userId, source },
  }));
}

export function removeCatalogOperationNotification(
  userId: string,
  notificationId: number,
  source: "center" | "external" = "external",
) {
  const notifications = readCatalogOperationNotificationInbox(userId).filter(
    (notification) => notification.id !== notificationId,
  );
  writeCatalogOperationNotificationInbox(userId, notifications);
  broadcastCatalogOperationNotificationsChanged(userId, source);
  return notifications;
}

export function clearCatalogOperationNotifications(
  userId: string,
  source: "center" | "external" = "external",
) {
  writeCatalogOperationNotificationInbox(userId, []);
  broadcastCatalogOperationNotificationsChanged(userId, source);
  return [] as StoredCatalogOperationNotification[];
}
