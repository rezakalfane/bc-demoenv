import "server-only";

import { requireAppUser } from "@/lib/auth";
import {
  getCatalogOperationsForChannel,
  getCatalogOperationsForSnapshots,
  getCatalogSnapshot,
  getCatalogSnapshotEventsByName,
  getCatalogSnapshotSummariesByIds,
  getCatalogSnapshotVersionsByName,
  type CatalogOperation,
  type CatalogSnapshotSummary,
} from "@/lib/db";

export type CatalogHistoryEntry = {
  id: string;
  title: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  details: string[];
  manualActions: CatalogHistoryManualAction[];
  error: string | null;
};

export type CatalogHistoryManualAction = {
  label: string;
  description: string;
  href: string;
};

function parseRecord(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function parseManualActions(value: unknown): CatalogHistoryManualAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const action = typeof entry === "object" && entry !== null
      ? entry as Record<string, unknown>
      : null;
    if (
      !action ||
      typeof action.label !== "string" ||
      typeof action.description !== "string" ||
      typeof action.href !== "string"
    ) return [];
    try {
      const url = new URL(action.href);
      if (
        url.protocol !== "https:" ||
        !/^store-[a-z0-9]+\.mybigcommerce\.com$/i.test(url.hostname)
      ) return [];
    } catch {
      return [];
    }
    return [{
      label: action.label,
      description: action.description,
      href: action.href,
    }];
  });
}

function operationEntry(
  operation: CatalogOperation,
  snapshot?: CatalogSnapshotSummary,
): CatalogHistoryEntry {
  const payload = parseRecord(operation.payloadJson);
  const result = parseRecord(operation.resultJson);
  const titles = { snapshot: "Snapshot captured", restore: "Snapshot restored", clear: "Catalog cleared", refresh: "Catalog refreshed", database_sync: "Database synchronized" } as const;
  const details: string[] = [];
  const manualActions = parseManualActions(result.manualActions);
  const snapshotName = snapshot?.name || (typeof result.snapshotName === "string" ? result.snapshotName : "");
  const snapshotVersion = snapshot?.snapshotVersion || Number(result.snapshotVersion) || null;
  if (snapshotName) {
    details.push(
      `Snapshot: ${snapshotName}${snapshotVersion ? ` · version ${snapshotVersion}` : ""}${operation.snapshotId ? ` · ID ${operation.snapshotId}` : ""}`,
    );
  } else if (operation.kind === "snapshot" && payload.name) {
    details.push(`Snapshot: ${String(payload.name)}`);
  } else if ((operation.kind === "restore" || operation.kind === "refresh") && operation.snapshotId) {
    details.push(`Snapshot ID: ${operation.snapshotId}`);
  }
  if (result.destinationEnvironmentName || result.destinationChannelName) details.push([result.destinationEnvironmentName, result.destinationChannelName].filter(Boolean).join(" · "));
  if ((operation.kind === "clear" || operation.kind === "refresh") && result.productsUnassigned !== undefined) details.push(`${Number(result.productsUnassigned)} products unassigned · ${Number(result.categoriesRemoved ?? 0)} categories removed`);
  if (operation.kind === "restore" || operation.kind === "refresh") {
    const created = Number(result.productsCreated ?? 0);
    const reportedUpdated = Number(result.productsUpdated ?? 0);
    const updated = reportedUpdated > 0
      ? reportedUpdated
      : Math.max((snapshot?.productCount ?? 0) - created, 0);
    const categories = Number(result.categoriesCreated ?? 0);
    if (operation.status === "completed") details.push(`${created} products created · ${updated} products updated · ${categories} categories created`);
    if (Array.isArray(result.warnings)) {
      details.push(...result.warnings.map((warning) => `Warning: ${String(warning)}`));
    }
  }
  if (operation.currentStep && operation.status !== "completed") details.push(operation.currentStep);
  return { id: `operation-${operation.id}`, title: titles[operation.kind], status: operation.status, createdAt: operation.createdAt, updatedAt: operation.updatedAt, details, manualActions, error: operation.error };
}

export async function getChannelCatalogHistory(environmentId: number, channelId: number) {
  const user = await requireAppUser();
  const operations = await getCatalogOperationsForChannel(user.id, environmentId, channelId);
  const snapshots = await getCatalogSnapshotSummariesByIds(
    user.id,
    operations.flatMap((operation) => operation.snapshotId ? [operation.snapshotId] : []),
  );
  const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  return operations.map((operation) => operationEntry(
    operation,
    operation.snapshotId ? snapshotsById.get(operation.snapshotId) : undefined,
  ));
}

export async function getSnapshotCatalogHistory(snapshotId: number) {
  const user = await requireAppUser();
  const snapshot = await getCatalogSnapshot(user.id, snapshotId);
  if (!snapshot) return [];
  const [versions, deletionEvents] = await Promise.all([
    getCatalogSnapshotVersionsByName(user.id, snapshot.name),
    getCatalogSnapshotEventsByName(user.id, snapshot.name),
  ]);
  const operations = await getCatalogOperationsForSnapshots(user.id, versions.map((version) => version.id));
  const versionEntries: CatalogHistoryEntry[] = versions.map((version) => ({
    id: `version-${version.id}`,
    title: version.snapshotVersion === 1 ? "Snapshot created" : `Snapshot updated to version ${version.snapshotVersion}`,
    status: "completed",
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    details: [`${version.sourceEnvironmentName} · ${version.sourceChannelName}`, `${version.categoryCount} categories · ${version.productCount} products · ${version.variantCount} variants`],
    manualActions: [],
    error: null,
  }));
  const eventEntries: CatalogHistoryEntry[] = deletionEvents.map((event) => {
    const payload = parseRecord(event.payloadJson);
    const eventTitle = {
      snapshot_renamed: "Snapshot renamed",
      version_deleted: `Snapshot version ${event.snapshotVersion} deleted`,
      version_published: `Snapshot version ${event.snapshotVersion} published`,
      version_unpublished: `Snapshot version ${event.snapshotVersion} unpublished`,
    }[event.eventType];
    const details = event.eventType === "snapshot_renamed"
      ? [
          `Renamed from ${String(payload.previousName ?? "Unknown")} to ${String(payload.name ?? event.snapshotName)}`,
          `Snapshot ID ${event.snapshotId}`,
        ]
      : [
          `Snapshot: ${event.snapshotName} · version ${event.snapshotVersion} · ID ${event.snapshotId}`,
          [payload.sourceEnvironmentName, payload.sourceChannelName].filter(Boolean).join(" · "),
          `${Number(payload.categoryCount ?? 0)} categories · ${Number(payload.productCount ?? 0)} products · ${Number(payload.variantCount ?? 0)} variants`,
        ].filter(Boolean);
    return {
      id: `snapshot-event-${event.id}`,
      title: eventTitle,
      status: "completed",
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      details,
      manualActions: [],
      error: null,
    };
  });
  const versionsById = new Map(versions.map((version) => [version.id, version]));
  return [...versionEntries, ...eventEntries, ...operations.filter((operation) => operation.kind === "restore" || operation.kind === "refresh").map((operation) => operationEntry(operation, operation.snapshotId ? versionsById.get(operation.snapshotId) : undefined))]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}
