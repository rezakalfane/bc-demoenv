import { FatalError } from "workflow";
import {
  getCatalogOperation,
  updateCatalogOperation,
  type CatalogOperation,
} from "@/lib/db";
import {
  clearCatalogChannel,
  restoreCatalogSnapshot,
  type CatalogRestoreResult,
  type ClearCatalogResult,
} from "@/lib/catalog-restore";
import {
  parseSnapshotRestoreGroups,
  type SnapshotRestoreGroup,
} from "@/lib/snapshot-configuration";

export type DurableCatalogOperationSpec =
  | { kind: "clear" }
  | { kind: "restore"; restoreGroups: SnapshotRestoreGroup[] };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function asStepError(error: unknown) {
  const message = errorMessage(error);
  if (
    /cancelled|not found|invalid|no longer published|choose at least one|matches more than one|could not be decrypted/i.test(
      message,
    )
  ) {
    return new FatalError(message);
  }
  return error;
}

async function requireActiveOperation(userId: string, operationId: number) {
  const operation = await getCatalogOperation(userId, operationId);
  if (!operation) throw new FatalError("The catalog operation was not found.");
  if (operation.status === "cancelled") {
    throw new FatalError("The catalog operation was cancelled.");
  }
  if (!["queued", "running"].includes(operation.status)) {
    throw new FatalError(`The catalog operation is ${operation.status}.`);
  }
  return operation;
}

function parsePayload(operation: CatalogOperation) {
  try {
    return JSON.parse(operation.payloadJson) as Record<string, unknown>;
  } catch {
    throw new FatalError("The catalog operation payload is invalid.");
  }
}

export async function initializeCatalogOperationStep(
  userId: string,
  operationId: number,
): Promise<DurableCatalogOperationSpec> {
  "use step";
  console.info("Initializing durable catalog operation", { operationId });
  const operation = await requireActiveOperation(userId, operationId);
  const payload = parsePayload(operation);
  await updateCatalogOperation(userId, operationId, {
    status: "running",
    currentStep: operation.kind === "restore"
      ? "Starting durable snapshot restoration"
      : "Starting durable catalog clear",
    stepIndex: 0,
    totalSteps: operation.kind === "restore"
      ? Math.max(parseSnapshotRestoreGroups(payload.restoreGroups).length, 1)
      : 1,
  });

  if (operation.kind === "clear") return { kind: "clear" };
  if (operation.kind === "restore") {
    const restoreGroups = parseSnapshotRestoreGroups(payload.restoreGroups);
    if (restoreGroups.length === 0) {
      throw new FatalError("Choose at least one snapshot section to restore.");
    }
    return { kind: "restore", restoreGroups };
  }
  throw new FatalError("Snapshot captures use a different durable workflow.");
}
initializeCatalogOperationStep.maxRetries = 2;

export async function restoreCatalogGroupStep(
  userId: string,
  operationId: number,
  restoreGroup: SnapshotRestoreGroup,
  groupIndex: number,
  totalGroups: number,
): Promise<CatalogRestoreResult> {
  "use step";
  console.info("Running durable snapshot restore group", {
    operationId,
    restoreGroup,
    groupIndex,
    totalGroups,
  });
  try {
    const operation = await requireActiveOperation(userId, operationId);
    const payload = parsePayload(operation);
    return await restoreCatalogSnapshot({
      snapshotId: Number(payload.snapshotId),
      destinationEnvironmentId: Number(payload.destinationEnvironmentId),
      destinationChannelId: Number(payload.destinationChannelId),
      restoreGroups: [restoreGroup],
      userId,
      onProgress: async (currentStep) => {
        await requireActiveOperation(userId, operationId);
        await updateCatalogOperation(userId, operationId, {
          currentStep,
          stepIndex: groupIndex,
          totalSteps: totalGroups,
        });
      },
    });
  } catch (error) {
    throw asStepError(error);
  }
}
restoreCatalogGroupStep.maxRetries = 3;

export async function clearCatalogStep(
  userId: string,
  operationId: number,
): Promise<ClearCatalogResult> {
  "use step";
  console.info("Running durable catalog clear", { operationId });
  try {
    const operation = await requireActiveOperation(userId, operationId);
    const payload = parsePayload(operation);
    return await clearCatalogChannel({
      destinationEnvironmentId: Number(payload.destinationEnvironmentId),
      destinationChannelId: Number(payload.destinationChannelId),
      userId,
      onProgress: async (currentStep, stepIndex = 0, totalSteps = 1) => {
        await requireActiveOperation(userId, operationId);
        await updateCatalogOperation(userId, operationId, {
          currentStep,
          stepIndex,
          totalSteps,
        });
      },
    });
  } catch (error) {
    throw asStepError(error);
  }
}
clearCatalogStep.maxRetries = 3;

function combineRestoreResults(results: CatalogRestoreResult[]) {
  const first = results[0];
  if (!first) throw new FatalError("The restore produced no result.");
  const warnings = [...new Set(results.flatMap((result) => result.warnings))];
  const manualActions = results
    .flatMap((result) => result.manualActions)
    .filter((action, index, all) =>
      all.findIndex((candidate) =>
        candidate.href === action.href && candidate.description === action.description
      ) === index,
    );
  return {
    ...first,
    categoriesCreated: results.reduce((sum, result) => sum + result.categoriesCreated, 0),
    categoriesUpdated: results.reduce((sum, result) => sum + result.categoriesUpdated, 0),
    categoriesRemoved: results.reduce((sum, result) => sum + result.categoriesRemoved, 0),
    productsCreated: results.reduce((sum, result) => sum + result.productsCreated, 0),
    productsUpdated: results.reduce((sum, result) => sum + result.productsUpdated, 0),
    productAssignmentsRemoved: results.reduce(
      (sum, result) => sum + result.productAssignmentsRemoved,
      0,
    ),
    warnings,
    manualActions,
    restoredGroups: [...new Set(results.flatMap((result) => result.restoredGroups))],
  } satisfies CatalogRestoreResult;
}

export async function completeRestoreOperationStep(
  userId: string,
  operationId: number,
  results: CatalogRestoreResult[],
) {
  "use step";
  console.info("Completing durable snapshot restore", { operationId });
  const operation = await requireActiveOperation(userId, operationId);
  const result = combineRestoreResults(results);
  await updateCatalogOperation(userId, operation.id, {
    status: "completed",
    currentStep: result.warnings.length > 0
      ? `Completed with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}`
      : "Completed",
    stepIndex: Math.max(result.restoredGroups.length, 1),
    totalSteps: Math.max(result.restoredGroups.length, 1),
    resultJson: JSON.stringify(result),
    error: null,
  });
  return result;
}
completeRestoreOperationStep.maxRetries = 2;

export async function completeClearOperationStep(
  userId: string,
  operationId: number,
  result: ClearCatalogResult,
) {
  "use step";
  console.info("Completing durable catalog clear", { operationId });
  const operation = await requireActiveOperation(userId, operationId);
  await updateCatalogOperation(userId, operation.id, {
    status: "completed",
    currentStep: "Completed",
    stepIndex: 1,
    totalSteps: 1,
    resultJson: JSON.stringify(result),
    error: null,
  });
  return result;
}
completeClearOperationStep.maxRetries = 2;

export async function failCatalogOperationStep(
  userId: string,
  operationId: number,
  message: string,
) {
  "use step";
  console.error("Durable catalog operation failed", { operationId, message });
  const operation = await getCatalogOperation(userId, operationId);
  if (!operation || operation.status === "cancelled") return;
  await updateCatalogOperation(userId, operationId, {
    status: "failed",
    currentStep: "Failed",
    error: message,
  });
}
failCatalogOperationStep.maxRetries = 2;
