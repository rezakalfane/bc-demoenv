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
  error: string | null;
};

function parseRecord(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

function operationEntry(
  operation: CatalogOperation,
  snapshot?: CatalogSnapshotSummary,
): CatalogHistoryEntry {
  const payload = parseRecord(operation.payloadJson);
  const result = parseRecord(operation.resultJson);
  const titles = { snapshot: "Snapshot captured", restore: "Snapshot restored", clear: "Catalog cleared" } as const;
  const details: string[] = [];
  const snapshotName = snapshot?.name || (typeof result.snapshotName === "string" ? result.snapshotName : "");
  const snapshotVersion = snapshot?.snapshotVersion || Number(result.snapshotVersion) || null;
  if (snapshotName) {
    details.push(
      `Snapshot: ${snapshotName}${snapshotVersion ? ` · version ${snapshotVersion}` : ""}${operation.snapshotId ? ` · ID ${operation.snapshotId}` : ""}`,
    );
  } else if (operation.kind === "snapshot" && payload.name) {
    details.push(`Snapshot: ${String(payload.name)}`);
  } else if (operation.kind === "restore" && operation.snapshotId) {
    details.push(`Snapshot ID: ${operation.snapshotId}`);
  }
  if (result.destinationEnvironmentName || result.destinationChannelName) details.push([result.destinationEnvironmentName, result.destinationChannelName].filter(Boolean).join(" · "));
  if (operation.kind === "clear" && result.productsUnassigned !== undefined) details.push(`${Number(result.productsUnassigned)} products unassigned · ${Number(result.categoriesRemoved ?? 0)} categories removed`);
  if (operation.kind === "restore") {
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
  return { id: `operation-${operation.id}`, title: titles[operation.kind], status: operation.status, createdAt: operation.createdAt, updatedAt: operation.updatedAt, details, error: operation.error };
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
    error: null,
  }));
  const deletionEntries: CatalogHistoryEntry[] = deletionEvents.map((event) => {
    const payload = parseRecord(event.payloadJson);
    return {
      id: `snapshot-event-${event.id}`,
      title: `Snapshot version ${event.snapshotVersion} deleted`,
      status: "completed",
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      details: [
        `Snapshot: ${event.snapshotName} · version ${event.snapshotVersion} · ID ${event.snapshotId}`,
        [payload.sourceEnvironmentName, payload.sourceChannelName].filter(Boolean).join(" · "),
        `${Number(payload.categoryCount ?? 0)} categories · ${Number(payload.productCount ?? 0)} products · ${Number(payload.variantCount ?? 0)} variants`,
      ].filter(Boolean),
      error: null,
    };
  });
  const versionsById = new Map(versions.map((version) => [version.id, version]));
  return [...versionEntries, ...deletionEntries, ...operations.filter((operation) => operation.kind === "restore").map((operation) => operationEntry(operation, operation.snapshotId ? versionsById.get(operation.snapshotId) : undefined))]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}
