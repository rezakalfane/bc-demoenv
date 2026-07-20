import "server-only";

import { getRun } from "workflow/api";
import type { WorkflowRunStatus } from "@workflow/world";
import {
  getCatalogSnapshotCaptureStates,
  getWorkflowCatalogOperations,
  type CatalogOperation,
  type CatalogSnapshotCaptureState,
} from "@/lib/db";
import { getCatalogOperationList } from "@/lib/catalog-operations-list";
import { reconcileCatalogOperationWorkflow } from "@/lib/start-catalog-snapshot-workflow";

export type WorkflowStageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowStage = {
  id: string;
  label: string;
  description: string;
  status: WorkflowStageStatus;
  progressPercent: number;
};

export type WorkflowRunListItem = {
  operationId: number;
  kind: CatalogOperation["kind"];
  workflowName: string;
  workflowRuntimeName: string;
  workflowRunId: string;
  appStatus: CatalogOperation["status"];
  runtimeStatus: WorkflowRunStatus | null;
  runtimeAvailable: boolean;
  runtimeError: string | null;
  environmentName: string;
  channelName: string;
  snapshotName: string;
  snapshotVersion: number | null;
  currentStep: string;
  progressPercent: number;
  stepIndex: number;
  totalSteps: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  durationMs: number;
  staleForMs: number;
  error: string | null;
  warningCount: number;
  manualActionCount: number;
  resourceHref: string | null;
  resourceLabel: string;
  canCancel: boolean;
  canRetry: boolean;
  payloadSummary: Array<{ label: string; value: string }>;
  resultSummary: Array<{ label: string; value: string }>;
  stages: WorkflowStage[];
};

function friendlyWorkflowName(
  runtimeName: string | null,
  kind: CatalogOperation["kind"],
) {
  const fallback = kind === "snapshot"
    ? "Catalog snapshot workflow"
    : kind === "restore"
      ? "Catalog restore workflow"
      : "Catalog clear workflow";
  if (!runtimeName) return fallback;

  const leaf = runtimeName
    .split("//")
    .filter(Boolean)
    .at(-1)
    ?.split("/")
    .filter(Boolean)
    .at(-1);
  if (!leaf) return fallback;

  const readable = leaf
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[-_]+/g, " ")
    .trim();
  if (!readable) return fallback;
  return readable.charAt(0).toLocaleUpperCase() + readable.slice(1);
}

function parseRecord(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function progress(operation: CatalogOperation) {
  if (operation.status === "completed") return 100;
  if (operation.totalSteps <= 0) return 0;
  return Math.min(
    Math.max(Math.round((operation.stepIndex / operation.totalSteps) * 100), 0),
    99,
  );
}

function terminalStageStatus(operation: CatalogOperation): WorkflowStageStatus {
  if (operation.status === "failed") return "failed";
  if (operation.status === "cancelled") return "cancelled";
  return operation.status === "completed" ? "completed" : "running";
}

function snapshotStages(
  operation: CatalogOperation,
  state: CatalogSnapshotCaptureState | undefined,
): WorkflowStage[] {
  const active = operation.status === "queued" || operation.status === "running";
  const initialized = Boolean(state);
  const categoriesDone = Boolean(
    state && state.nextCategoryIndex >= state.totalCategories,
  );
  const productsDone = Boolean(
    state && state.initializationComplete && state.nextProductIndex >= state.totalProducts,
  );
  const categoryProgress = state && state.totalCategories > 0
    ? Math.round((state.nextCategoryIndex / state.totalCategories) * 100)
    : categoriesDone ? 100 : 0;
  const productProgress = state && state.totalProducts > 0
    ? Math.round((state.nextProductIndex / state.totalProducts) * 100)
    : productsDone ? 100 : 0;
  const stopped = operation.status === "failed" || operation.status === "cancelled";

  const settingsGroups = [
    {
      id: "channel-storefront",
      label: "Channel & storefront settings",
      description: "Channel metadata, sites, routes, theme metadata, and effective storefront overrides.",
      matches: /channel and storefront|effective storefront/i,
      marker: 89,
    },
    {
      id: "experience",
      label: "Checkout & customer experience",
      description: "Checkout, cart, order, abandoned-cart, privacy, and customer-group settings.",
      matches: /checkout and customer experience/i,
      marker: 91,
    },
    {
      id: "pricing",
      label: "Pricing & currencies",
      description: "Store currencies, channel assignments, price lists, and price-list records.",
      matches: /currency and price-list/i,
      marker: 91,
    },
    {
      id: "shipping",
      label: "Shipping",
      description: "Channel shipping settings, store-wide zones, methods, and channel associations.",
      matches: /shipping configuration/i,
      marker: 92,
    },
    {
      id: "tax",
      label: "Tax",
      description: "Store-wide tax settings, zones, rates, and catalog tax classes.",
      matches: /tax configuration/i,
      marker: 93,
    },
    {
      id: "b2b",
      label: "B2B Edition",
      description: "Detect B2B availability and capture supported Companies, users, roles, and demo records.",
      matches: /b2b edition/i,
      marker: 94,
    },
    {
      id: "localization-inventory",
      label: "Inventory, localization & presentation",
      description: "Inventory locations, locales, translations, scripts, and presentation metadata.",
      matches: /locales, translations|presentation metadata/i,
      marker: 95,
    },
  ];
  const currentSettingsIndex = settingsGroups.findIndex((group) =>
    group.matches.test(operation.currentStep)
  );
  const settingsComplete = Boolean(state?.initializationComplete) || operation.status === "completed";
  const settingsStarted = settingsComplete || currentSettingsIndex >= 0 || operation.stepIndex >= 89;
  const settingsStages: WorkflowStage[] = settingsGroups.map((group, index) => {
    const isCurrent = !settingsComplete && currentSettingsIndex === index;
    const isComplete = settingsComplete || currentSettingsIndex > index || (
      currentSettingsIndex < 0 && operation.stepIndex > group.marker
    );
    return {
      id: group.id,
      label: group.label,
      description: isCurrent ? operation.currentStep : group.description,
      status: isComplete
        ? "completed"
        : isCurrent
          ? stopped ? terminalStageStatus(operation) : "running"
          : "pending",
      progressPercent: isComplete ? 100 : isCurrent ? 50 : 0,
    };
  });

  return [
    {
      id: "initialize",
      label: "Initialize",
      description: "Load channel assignments, supporting settings, and durable checkpoint state.",
      status: initialized || operation.status === "completed"
        ? "completed"
        : stopped ? terminalStageStatus(operation) : active ? "running" : "pending",
      progressPercent: initialized || operation.status === "completed" ? 100 : 0,
    },
    {
      id: "categories",
      label: "Capture categories",
      description: state
        ? `${state.nextCategoryIndex} of ${state.totalCategories} categories checkpointed`
        : "Waiting for category discovery",
      status: categoriesDone || operation.status === "completed"
        ? "completed"
        : stopped && initialized ? terminalStageStatus(operation) : initialized ? "running" : "pending",
      progressPercent: categoriesDone || operation.status === "completed" ? 100 : categoryProgress,
    },
    {
      id: "catalog-context",
      label: "Prepare catalog context",
      description: settingsStarted
        ? "Channel product assignments, brands, tax classes, and store currency are checkpointed."
        : "Resolve channel product assignments and supporting catalog records.",
      status: settingsStarted
        ? "completed"
        : stopped && categoriesDone
          ? terminalStageStatus(operation)
          : categoriesDone ? "running" : "pending",
      progressPercent: settingsStarted ? 100 : 0,
    },
    ...settingsStages,
    {
      id: "products",
      label: "Capture products",
      description: state
        ? `${state.nextProductIndex} of ${state.totalProducts} channel products checkpointed`
        : "Waiting for product capture",
      status: productsDone || operation.status === "completed"
        ? "completed"
        : stopped && settingsComplete
          ? terminalStageStatus(operation)
          : settingsComplete ? "running" : "pending",
      progressPercent: productsDone || operation.status === "completed" ? 100 : productProgress,
    },
    {
      id: "finalize",
      label: "Finalize version",
      description: "Validate the manifest and atomically create the immutable snapshot version.",
      status: operation.status === "completed"
        ? "completed"
        : stopped && productsDone ? terminalStageStatus(operation) : productsDone ? "running" : "pending",
      progressPercent: operation.status === "completed" ? 100 : 0,
    },
  ];
}

function operationStages(operation: CatalogOperation, payload: Record<string, unknown>) {
  if (operation.kind === "clear") {
    const active = operation.status === "queued" || operation.status === "running";
    const stopped = operation.status === "failed" || operation.status === "cancelled";
    const productStageStarted = /product assignments|unassigning products/i.test(operation.currentStep);
    const categoryStageStarted = /removing categories/i.test(operation.currentStep);
    const verificationStarted = /verified:/i.test(operation.currentStep);
    const initializationComplete = productStageStarted || categoryStageStarted ||
      verificationStarted || operation.status === "completed";
    const productsComplete = categoryStageStarted || verificationStarted ||
      operation.status === "completed";
    const categoriesComplete = verificationStarted || operation.status === "completed";
    return [
      {
        id: "initialize",
        label: "Initialize",
        description: "Validate the destination channel and credentials.",
        status: initializationComplete
          ? "completed"
          : stopped ? terminalStageStatus(operation) : active ? "running" : "pending",
        progressPercent: initializationComplete ? 100 : 0,
      },
      {
        id: "unassign-products",
        label: "Unassign products",
        description: productStageStarted && !productsComplete
          ? operation.currentStep
          : "Remove every product assignment from the destination channel without deleting products.",
        status: productsComplete
          ? "completed"
          : stopped && initializationComplete
            ? terminalStageStatus(operation)
            : initializationComplete ? "running" : "pending",
        progressPercent: productsComplete ? 100 : productStageStarted ? 50 : 0,
      },
      {
        id: "remove-categories",
        label: "Remove channel categories",
        description: categoryStageStarted && !categoriesComplete
          ? operation.currentStep
          : "Remove category assignments from the destination channel trees.",
        status: categoriesComplete
          ? "completed"
          : stopped && productsComplete
            ? terminalStageStatus(operation)
            : productsComplete ? "running" : "pending",
        progressPercent: categoriesComplete ? 100 : categoryStageStarted ? 50 : 0,
      },
      {
        id: "verify-clear",
        label: "Verify catalog is clear",
        description: verificationStarted
          ? operation.currentStep
          : "Confirm BigCommerce no longer returns product or category assignments for the channel.",
        status: operation.status === "completed"
          ? "completed"
          : stopped && categoriesComplete
            ? terminalStageStatus(operation)
            : verificationStarted ? "running" : "pending",
        progressPercent: operation.status === "completed" ? 100 : 0,
      },
    ] satisfies WorkflowStage[];
  }

  const groups = strings(payload.restoreGroups);
  const stages: WorkflowStage[] = [{
    id: "initialize",
    label: "Initialize",
    description: "Validate snapshot access, destination, and selected restore sections.",
    status: operation.status === "queued" ? "running" : "completed",
    progressPercent: operation.status === "queued" ? 0 : 100,
  }];
  groups.forEach((group, index) => {
    const groupPosition = index + 1;
    const isDone = operation.status === "completed" || operation.stepIndex > groupPosition;
    const isCurrent = operation.status === "running" && operation.stepIndex === groupPosition;
    const isStoppedHere = ["failed", "cancelled"].includes(operation.status) &&
      Math.max(operation.stepIndex, 1) === groupPosition;
    stages.push({
      id: group,
      label: group.replaceAll("_", " "),
      description: isCurrent ? operation.currentStep : `Restore the ${group.replaceAll("_", " ")} section.`,
      status: isDone ? "completed" : isStoppedHere ? terminalStageStatus(operation) : isCurrent ? "running" : "pending",
      progressPercent: isDone ? 100 : isCurrent ? 50 : 0,
    });
  });
  stages.push({
    id: "finalize",
    label: "Finalize",
    description: "Combine results, warnings, and manual follow-up actions.",
    status: operation.status === "completed" ? "completed" : "pending",
    progressPercent: operation.status === "completed" ? 100 : 0,
  });
  return stages;
}

async function runtimeMetadata(operation: CatalogOperation, inspect: boolean) {
  if (!operation.workflowRunId || !inspect) {
    return {
      available: false,
      status: null as WorkflowRunStatus | null,
      name: null as string | null,
      createdAt: null as string | null,
      startedAt: null as string | null,
      completedAt: null as string | null,
      error: null as string | null,
    };
  }
  try {
    const run = getRun(operation.workflowRunId);
    if (!(await run.exists)) throw new Error("Run metadata is no longer available.");
    const [status, name, createdAt, startedAt, completedAt] = await Promise.all([
      run.status,
      run.workflowName,
      run.createdAt,
      run.startedAt,
      run.completedAt,
    ]);
    return {
      available: true,
      status,
      name,
      createdAt: createdAt.toISOString(),
      startedAt: startedAt?.toISOString() ?? null,
      completedAt: completedAt?.toISOString() ?? null,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      status: null,
      name: null,
      createdAt: null,
      startedAt: null,
      completedAt: null,
      error: error instanceof Error ? error.message : "Run metadata is unavailable.",
    };
  }
}

function summaryEntries(record: Record<string, unknown>, keys: string[]) {
  return keys.flatMap((key) => {
    const value = record[key];
    if (value === undefined || value === null || value === "") return [];
    const rendered = Array.isArray(value)
      ? `${value.length} selected`
      : typeof value === "object" ? "Captured" : String(value);
    return [{ label: key.replaceAll(/([A-Z])/g, " $1").replaceAll("_", " "), value: rendered }];
  });
}

export async function getWorkflowRunList(userId: string) {
  let operations = await getWorkflowCatalogOperations(userId);
  for (const operation of operations.filter((item) =>
    item.status === "queued" || item.status === "running"
  )) {
    await reconcileCatalogOperationWorkflow(userId, operation);
  }
  operations = await getWorkflowCatalogOperations(userId);

  const [operationList, captureStates] = await Promise.all([
    getCatalogOperationList(userId),
    getCatalogSnapshotCaptureStates(
      userId,
      operations.filter((item) => item.kind === "snapshot").map((item) => item.id),
    ),
  ]);
  const presentationById = new Map(
    operationList
      .filter((item) => item.activityKey.startsWith("operation-"))
      .map((item) => [item.id, item]),
  );
  const captureById = new Map(captureStates.map((state) => [state.operationId, state]));
  const now = Date.now();
  const metadata = await Promise.all(
    operations.map((operation, index) => runtimeMetadata(
      operation,
      index < 20 || operation.status === "queued" || operation.status === "running",
    )),
  );

  return operations.map((operation, index): WorkflowRunListItem => {
    const view = presentationById.get(operation.id);
    const payload = parseRecord(operation.payloadJson);
    const result = parseRecord(operation.resultJson);
    const runtime = metadata[index];
    const createdAt = runtime.createdAt ?? operation.createdAt;
    const completedAt = runtime.completedAt ?? (
      ["completed", "failed", "cancelled"].includes(operation.status)
        ? operation.updatedAt
        : null
    );
    const startedAt = runtime.startedAt ?? (operation.status === "queued" ? null : operation.createdAt);
    const durationMs = Math.max(
      Date.parse(completedAt ?? new Date().toISOString()) - Date.parse(startedAt ?? createdAt),
      0,
    );
    const warnings = strings(result.warnings);
    const manualActions = Array.isArray(result.manualActions) ? result.manualActions : [];
    const runtimeName = runtime.name ?? (operation.kind === "snapshot"
      ? "catalogSnapshotWorkflow"
      : "catalogOperationWorkflow");
    return {
      operationId: operation.id,
      kind: operation.kind,
      workflowName: friendlyWorkflowName(runtimeName, operation.kind),
      workflowRuntimeName: runtimeName,
      workflowRunId: operation.workflowRunId ?? "",
      appStatus: operation.status,
      runtimeStatus: runtime.status,
      runtimeAvailable: runtime.available,
      runtimeError: runtime.error,
      environmentName: view?.environmentName ?? "—",
      channelName: view?.channelName ?? "—",
      snapshotName: view?.snapshotName ?? "—",
      snapshotVersion: view?.snapshotVersion ?? null,
      currentStep: operation.currentStep || "Waiting to start",
      progressPercent: progress(operation),
      stepIndex: operation.stepIndex,
      totalSteps: operation.totalSteps,
      createdAt,
      startedAt,
      completedAt,
      updatedAt: operation.updatedAt,
      durationMs,
      staleForMs: Math.max(now - Date.parse(operation.updatedAt), 0),
      error: operation.error,
      warningCount: warnings.length,
      manualActionCount: manualActions.length,
      resourceHref: view?.resourceHref ?? null,
      resourceLabel: view?.resourceLabel ?? "Open resource",
      canCancel: operation.status === "queued" || operation.status === "running",
      canRetry: operation.status === "failed" || operation.status === "cancelled",
      payloadSummary: summaryEntries(payload, [
        "name",
        "snapshotId",
        "destinationEnvironmentId",
        "destinationChannelId",
        "restoreGroups",
      ]),
      resultSummary: summaryEntries(result, [
        "snapshotVersion",
        "categoriesCreated",
        "categoriesUpdated",
        "productsCreated",
        "productsUpdated",
        "productsUnassigned",
        "categoriesRemoved",
      ]),
      stages: operation.kind === "snapshot"
        ? snapshotStages(operation, captureById.get(operation.id))
        : operationStages(operation, payload),
    };
  });
}
