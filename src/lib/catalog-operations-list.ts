import "server-only";

import {
  getApplicationEvents,
  getBigCommerceEnvironments,
  getCatalogOperations,
  getCatalogSnapshotSeries,
  getCatalogSnapshotEvents,
  getCatalogSnapshotSummariesByIds,
  type CatalogOperation,
} from "@/lib/db";
import { operationProgressPercent } from "@/lib/operation-progress";

export type OperationKind = CatalogOperation["kind"] |
  "snapshot_renamed" |
  "version_published" |
  "version_unpublished" |
  "version_deleted" |
  "environment_added" |
  "environment_deleted" |
  "snapshot_deleted";
export type OperationStatus = CatalogOperation["status"];

export type OperationManualAction = {
  label: string;
  description: string;
  href: string;
};

export type OperationMetric = {
  label: string;
  value: string;
};

export type CatalogOperationListItem = {
  activityKey: string;
  id: number;
  kind: OperationKind;
  status: OperationStatus;
  title: string;
  environmentId: number | null;
  environmentName: string;
  channelId: number | null;
  channelName: string;
  snapshotId: number | null;
  snapshotName: string;
  snapshotVersion: number | null;
  currentStep: string;
  stepIndex: number;
  totalSteps: number;
  progressPercent: number;
  showProgress: boolean;
  workflowRunId: string | null;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  error: string | null;
  warnings: string[];
  manualActions: OperationManualAction[];
  metrics: OperationMetric[];
  restoreGroups: string[];
  resourceHref: string | null;
  resourceLabel: string;
};

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseRecord(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return {} as Record<string, unknown>;
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    : [];
}

function readManualActions(value: unknown): OperationManualAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const action = asRecord(entry);
    const label = readString(action.label);
    const description = readString(action.description);
    const href = readString(action.href);
    if (!label || !description || !href) return [];
    try {
      const url = new URL(href);
      if (
        url.protocol !== "https:" ||
        !/^store-[a-z0-9]+\.mybigcommerce\.com$/i.test(url.hostname)
      ) return [];
    } catch {
      return [];
    }
    return [{ label, description, href }];
  });
}

function metric(label: string, value: unknown): OperationMetric | null {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number)
    ? { label, value: new Intl.NumberFormat("en").format(number) }
    : null;
}

function operationMetrics(
  operation: CatalogOperation,
  result: Record<string, unknown>,
  snapshot: Awaited<ReturnType<typeof getCatalogSnapshotSummariesByIds>>[number] | undefined,
) {
  const values = operation.kind === "database_sync"
    ? [
        metric("Tables", result.tableCount),
        metric("Rows", result.rowCount),
        Number(result.skippedRowCount ?? 0) > 0
          ? metric("Ownerless notes skipped", result.skippedRowCount)
          : null,
      ]
    : operation.kind === "snapshot" && snapshot
    ? [
        metric("Categories", snapshot.categoryCount),
        metric("Products", snapshot.productCount),
        metric("Variants", snapshot.variantCount),
        metric("Images", snapshot.imageCount),
      ]
    : operation.kind === "restore" || operation.kind === "refresh"
      ? [
          metric("Categories created", result.categoriesCreated),
          metric("Categories updated", result.categoriesUpdated),
          metric("Products created", result.productsCreated),
          metric("Products matched", result.productsUpdated),
          ...(operation.kind === "refresh" ? [
            metric("Products cleared", asRecord(result.clearResult).productsUnassigned),
            metric("Categories cleared", asRecord(result.clearResult).categoriesRemoved),
          ] : []),
        ]
      : [
          metric("Categories removed", result.categoriesRemoved),
          metric("Products unassigned", result.productsUnassigned),
        ];
  return values.flatMap((value) => value ? [value] : []);
}

export async function getCatalogOperationList(userId: string) {
  const [operations, environments, snapshotEvents, applicationEvents, snapshotSeries] = await Promise.all([
    getCatalogOperations(userId),
    getBigCommerceEnvironments(userId),
    getCatalogSnapshotEvents(userId),
    getApplicationEvents(userId),
    getCatalogSnapshotSeries(userId),
  ]);
  const snapshots = await getCatalogSnapshotSummariesByIds(
    userId,
    [
      ...operations.flatMap((operation) => operation.snapshotId ? [operation.snapshotId] : []),
      ...snapshotEvents.map((event) => event.snapshotId),
    ],
  );
  const environmentsById = new Map(environments.map((environment) => [environment.id, environment]));
  const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const latestSnapshotByName = new Map(
    snapshotSeries.map((snapshot) => [snapshot.name.normalize("NFKC").toLocaleLowerCase(), snapshot]),
  );
  const now = Date.now();

  const catalogRows = operations.map((operation): CatalogOperationListItem => {
    const payload = parseRecord(operation.payloadJson);
    const result = parseRecord(operation.resultJson);
    const snapshot = operation.snapshotId ? snapshotsById.get(operation.snapshotId) : undefined;
    const isDatabaseSync = operation.kind === "database_sync";
    const environmentName = (isDatabaseSync ? readString(result.source) || readString(payload.source) : "") ||
      readString(result.destinationEnvironmentName) ||
      (operation.environmentId ? environmentsById.get(operation.environmentId)?.name ?? "" : "") ||
      (operation.environmentId ? `Environment #${operation.environmentId}` : "—");
    const syncDestination = readString(result.destination) || readString(payload.destination);
    const channelName = (isDatabaseSync && syncDestination ? `→ ${syncDestination}` : "") ||
      readString(result.destinationChannelName) ||
      (operation.kind === "snapshot" ? snapshot?.sourceChannelName ?? "" : "") ||
      (operation.channelId ? `Channel #${operation.channelId}` : "—");
    const snapshotName = snapshot?.name || readString(result.snapshotName) ||
      readString(payload.name) || (operation.snapshotId ? `Snapshot #${operation.snapshotId}` : "—");
    const linkedSnapshot = snapshot ??
      latestSnapshotByName.get(snapshotName.normalize("NFKC").toLocaleLowerCase());
    const snapshotVersion = snapshot?.snapshotVersion || readNumber(result.snapshotVersion) || null;
    const warnings = readStringArray(result.warnings);
    const manualActions = readManualActions(result.manualActions);
    const restoreGroups = readStringArray(result.restoredGroups).length > 0
      ? readStringArray(result.restoredGroups)
      : readStringArray(payload.restoreGroups);
    const parsedCreatedTime = Date.parse(operation.createdAt);
    const createdTime = Number.isFinite(parsedCreatedTime) ? parsedCreatedTime : now;
    const parsedUpdatedTime = Date.parse(operation.updatedAt);
    const updatedTime = Number.isFinite(parsedUpdatedTime) ? parsedUpdatedTime : createdTime;
    const isActive = operation.status === "queued" || operation.status === "running";
    const durationMs = Math.max((isActive ? now : updatedTime) - createdTime, 0);
    const progressPercent = operationProgressPercent(operation);
    const resourceHref = isDatabaseSync
      ? "/settings#database"
      : operation.kind === "snapshot" && linkedSnapshot
      ? `/snapshots/${linkedSnapshot.id}`
      : operation.environmentId && operation.channelId
        ? `/environments/${operation.environmentId}/channels/${operation.channelId}`
        : linkedSnapshot ? `/snapshots/${linkedSnapshot.id}` : null;

    return {
      activityKey: `operation-${operation.id}`,
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      title: {
        snapshot: "Snapshot capture",
        restore: "Snapshot restore",
        clear: "Catalog clear",
        refresh: "Clear & Restore",
        database_sync: "Database sync",
      }[operation.kind],
      environmentId: operation.environmentId,
      environmentName,
      channelId: operation.channelId,
      channelName,
      snapshotId: operation.snapshotId,
      snapshotName,
      snapshotVersion,
      currentStep: operation.currentStep || (operation.status === "queued" ? "Waiting to start" : "—"),
      stepIndex: operation.stepIndex,
      totalSteps: operation.totalSteps,
      progressPercent,
      showProgress: true,
      workflowRunId: operation.workflowRunId,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      durationMs,
      error: operation.error,
      warnings,
      manualActions,
      metrics: operationMetrics(operation, result, snapshot),
      restoreGroups,
      resourceHref,
      resourceLabel: isDatabaseSync
        ? "Open database settings"
        : operation.kind === "snapshot" && linkedSnapshot
        ? "Open snapshot"
        : operation.environmentId && operation.channelId ? "Open channel" : "View resource",
    };
  });

  const snapshotEventRows = snapshotEvents.map((event): CatalogOperationListItem => {
    const payload = parseRecord(event.payloadJson);
    const snapshot = snapshotsById.get(event.snapshotId) ??
      latestSnapshotByName.get(event.snapshotName.normalize("NFKC").toLocaleLowerCase());
    const titles: Record<typeof event.eventType, string> = {
      snapshot_renamed: "Snapshot renamed",
      version_deleted: "Version deleted",
      version_published: "Version published",
      version_unpublished: "Version unpublished",
    };
    const previousName = readString(payload.previousName);
    const currentStep = event.eventType === "snapshot_renamed"
      ? `${previousName || "Snapshot"} → ${event.snapshotName}`
      : `${event.snapshotName} · version ${event.snapshotVersion}`;
    const resourceHref = snapshot ? `/snapshots/${snapshot.id}` : null;
    return {
      activityKey: `snapshot-event-${event.id}`,
      id: event.id,
      kind: event.eventType,
      status: "completed",
      title: titles[event.eventType],
      environmentId: snapshot?.sourceEnvironmentId ?? null,
      environmentName: readString(payload.sourceEnvironmentName) || snapshot?.sourceEnvironmentName || "—",
      channelId: snapshot?.sourceChannelId ?? null,
      channelName: readString(payload.sourceChannelName) || snapshot?.sourceChannelName || "—",
      snapshotId: event.snapshotId,
      snapshotName: event.snapshotName,
      snapshotVersion: event.snapshotVersion,
      currentStep,
      stepIndex: 1,
      totalSteps: 1,
      progressPercent: 100,
      showProgress: false,
      workflowRunId: null,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      durationMs: 0,
      error: null,
      warnings: [],
      manualActions: [],
      metrics: [
        metric("Categories", payload.categoryCount),
        metric("Products", payload.productCount),
        metric("Variants", payload.variantCount),
      ].flatMap((value) => value ? [value] : []),
      restoreGroups: [],
      resourceHref,
      resourceLabel: resourceHref ? "Open snapshot" : "View resource",
    };
  });

  const applicationEventRows = applicationEvents.map((event): CatalogOperationListItem => {
    const payload = parseRecord(event.payloadJson);
    const environment = event.resourceType === "environment" && event.resourceId
      ? environmentsById.get(event.resourceId)
      : undefined;
    const titles: Record<typeof event.eventType, string> = {
      environment_added: "Environment added",
      environment_deleted: "Environment deleted",
      snapshot_deleted: "Snapshot deleted",
    };
    const isEnvironment = event.resourceType === "environment";
    const resourceHref = event.eventType === "environment_added" && environment
      ? `/environments/${environment.id}`
      : null;
    const environmentName = isEnvironment
      ? event.resourceName
      : readString(payload.sourceEnvironmentName) || "—";
    const currentStep = event.eventType === "snapshot_deleted"
      ? `${readNumber(payload.versionCount)} version${readNumber(payload.versionCount) === 1 ? "" : "s"} removed`
      : `Store ${readString(payload.storeHash) || "details retained for audit"}`;
    return {
      activityKey: `application-event-${event.id}`,
      id: event.id,
      kind: event.eventType,
      status: "completed",
      title: titles[event.eventType],
      environmentId: isEnvironment ? event.resourceId : null,
      environmentName,
      channelId: null,
      channelName: isEnvironment ? "—" : readString(payload.sourceChannelName) || "—",
      snapshotId: event.resourceType === "snapshot" ? event.resourceId : null,
      snapshotName: event.resourceType === "snapshot" ? event.resourceName : "—",
      snapshotVersion: event.eventType === "snapshot_deleted" ? readNumber(payload.latestVersion) || null : null,
      currentStep,
      stepIndex: 1,
      totalSteps: 1,
      progressPercent: 100,
      showProgress: false,
      workflowRunId: null,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      durationMs: 0,
      error: null,
      warnings: [],
      manualActions: [],
      metrics: event.eventType === "snapshot_deleted" ? [
        metric("Versions", payload.versionCount),
        metric("Categories", payload.categoryCount),
        metric("Products", payload.productCount),
        metric("Variants", payload.variantCount),
      ].flatMap((value) => value ? [value] : []) : [],
      restoreGroups: [],
      resourceHref,
      resourceLabel: resourceHref ? "Open environment" : "View resource",
    };
  });

  const recordedEnvironmentAdds = new Set(applicationEvents.flatMap((event) =>
    event.eventType === "environment_added" && event.resourceId ? [event.resourceId] : [],
  ));
  const inferredEnvironmentRows = environments
    .filter((environment) => !recordedEnvironmentAdds.has(environment.id))
    .map((environment): CatalogOperationListItem => ({
      activityKey: `environment-created-${environment.id}`,
      id: environment.id,
      kind: "environment_added",
      status: "completed",
      title: "Environment added",
      environmentId: environment.id,
      environmentName: environment.name,
      channelId: null,
      channelName: "—",
      snapshotId: null,
      snapshotName: "—",
      snapshotVersion: null,
      currentStep: `Store ${environment.storeHash}`,
      stepIndex: 1,
      totalSteps: 1,
      progressPercent: 100,
      showProgress: false,
      workflowRunId: null,
      createdAt: environment.createdAt,
      updatedAt: environment.createdAt,
      durationMs: 0,
      error: null,
      warnings: [],
      manualActions: [],
      metrics: [],
      restoreGroups: [],
      resourceHref: `/environments/${environment.id}`,
      resourceLabel: "Open environment",
    }));

  return [...catalogRows, ...snapshotEventRows, ...applicationEventRows, ...inferredEnvironmentRows]
    .toSorted((left, right) => {
      const leftTime = Date.parse(left.updatedAt);
      const rightTime = Date.parse(right.updatedAt);
      const safeLeftTime = Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY;
      const safeRightTime = Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY;
      return safeRightTime - safeLeftTime;
    });
}
