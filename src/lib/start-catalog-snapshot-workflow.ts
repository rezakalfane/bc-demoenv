import { getRun, start } from "workflow/api";
import {
  claimCatalogOperationWorkflowRecovery,
  createCatalogOperation,
  getCatalogOperation,
  type CatalogOperation,
  updateCatalogOperation,
} from "@/lib/db";
import { catalogSnapshotWorkflow } from "@/workflows/catalog-snapshot";
import { catalogOperationWorkflow } from "@/workflows/catalog-operation";

export async function startCatalogOperationWorkflow(
  userId: string,
  operationId: number,
) {
  const operation = await getCatalogOperation(userId, operationId);
  if (!operation) throw new Error("The catalog operation was not found.");

  try {
    const run = operation.kind === "snapshot"
      ? await start(catalogSnapshotWorkflow, [userId, operationId])
      : await start(catalogOperationWorkflow, [userId, operationId]);
    await updateCatalogOperation(userId, operationId, {
      workflowRunId: run.runId,
    });
    return run.runId;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "The durable catalog workflow could not be started.";
    await updateCatalogOperation(userId, operationId, {
      status: "failed",
      currentStep: "Failed",
      error: message,
    });
    throw error;
  }
}

export const startCatalogSnapshotWorkflow = startCatalogOperationWorkflow;

export async function retryCatalogOperationWorkflow(
  userId: string,
  operationId: number,
) {
  const operation = await getCatalogOperation(userId, operationId);
  if (!operation) throw new Error("The catalog operation was not found.");
  if (["queued", "running"].includes(operation.status)) {
    throw new Error("The catalog operation is still active.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(operation.payloadJson) as unknown;
  } catch {
    throw new Error("The catalog operation payload is invalid.");
  }

  const replacementId = await createCatalogOperation(userId, {
    kind: operation.kind,
    environmentId: operation.environmentId ?? undefined,
    channelId: operation.channelId ?? undefined,
    snapshotId: operation.snapshotId ?? undefined,
    payload,
    totalSteps: operation.totalSteps,
    operationKey: operation.operationKey ?? undefined,
  });
  await startCatalogOperationWorkflow(userId, replacementId);
  return replacementId;
}

export const CATALOG_WORKFLOW_RUN_NOT_FOUND_ERROR =
  "The durable catalog workflow run was not found.";

function localServerStartedAt() {
  return new Date(Date.now() - process.uptime() * 1_000 + 1_000);
}

async function recoverOrphanedLocalWorkflow(
  userId: string,
  operation: CatalogOperation,
  options: { runExists?: boolean } = {},
) {
  if (
    process.env.NODE_ENV !== "development" ||
    !operation.workflowRunId
  ) {
    return false;
  }

  const isMissingRunFailure =
    operation.status === "failed" &&
    operation.error === CATALOG_WORKFLOW_RUN_NOT_FOUND_ERROR;
  const serverStartedAt = localServerStartedAt();
  if (
    !isMissingRunFailure &&
    Date.parse(operation.updatedAt) >= serverStartedAt.getTime()
  ) {
    return false;
  }

  // A missing-run failure may have been recorded after this server started.
  // The workflow_run_id is cleared by the atomic claim so concurrent polls
  // cannot both attach replacement runs to the same durable checkpoint.
  const recoveryBoundary = isMissingRunFailure
    ? new Date(Date.now() + 1_000)
    : serverStartedAt;

  const claimed = await claimCatalogOperationWorkflowRecovery(
    userId,
    operation.id,
    operation.workflowRunId,
    recoveryBoundary,
    CATALOG_WORKFLOW_RUN_NOT_FOUND_ERROR,
  );
  if (!claimed) return false;

  console.info("Recovering catalog workflow after local server restart", {
    operationId: operation.id,
    previousWorkflowRunId: operation.workflowRunId,
    checkpointUpdatedAt: operation.updatedAt,
  });

  if (options.runExists !== false) {
    await cancelCatalogOperationWorkflow(operation);
  }
  await startCatalogOperationWorkflow(userId, operation.id);
  return true;
}

export async function reconcileCatalogOperationWorkflow(
  userId: string,
  operation: CatalogOperation,
) {
  const isRecoverableMissingRunFailure =
    process.env.NODE_ENV === "development" &&
    operation.status === "failed" &&
    operation.error === CATALOG_WORKFLOW_RUN_NOT_FOUND_ERROR;
  if (
    !operation.workflowRunId ||
    (
      !["queued", "running"].includes(operation.status) &&
      !isRecoverableMissingRunFailure
    )
  ) {
    return;
  }

  try {
    const run = getRun<unknown>(operation.workflowRunId);
    if (!(await run.exists)) {
      if (
        await recoverOrphanedLocalWorkflow(userId, operation, {
          runExists: false,
        })
      ) {
        return;
      }
      if (isRecoverableMissingRunFailure) return;
      await updateCatalogOperation(userId, operation.id, {
        status: "failed",
        currentStep: "Failed",
        error: CATALOG_WORKFLOW_RUN_NOT_FOUND_ERROR,
      });
      return;
    }

    const status = await run.status;
    if (
      (status === "pending" || status === "running") &&
      await recoverOrphanedLocalWorkflow(userId, operation)
    ) {
      return;
    }

    if (status === "running" && operation.status === "queued") {
      await updateCatalogOperation(userId, operation.id, {
        status: "running",
        currentStep: operation.kind === "snapshot"
          ? "Starting durable snapshot capture"
          : operation.kind === "restore"
            ? "Starting durable snapshot restoration"
            : "Starting durable catalog clear",
      });
      return;
    }

    if (status === "cancelled") {
      await updateCatalogOperation(userId, operation.id, {
        status: "cancelled",
        currentStep: "Cancelled",
      });
      return;
    }

    if (status === "failed") {
      let message = "The durable catalog workflow failed before completing.";
      try {
        await run.returnValue;
      } catch (error) {
        if (error instanceof Error && error.message) message = error.message;
      }
      await updateCatalogOperation(userId, operation.id, {
        status: "failed",
        currentStep: "Failed",
        error: message,
      });
    }
  } catch (error) {
    console.warn("Unable to reconcile durable catalog workflow status", {
      operationId: operation.id,
      workflowRunId: operation.workflowRunId,
      error,
    });
  }
}

export const reconcileCatalogSnapshotWorkflow = reconcileCatalogOperationWorkflow;

export async function cancelCatalogOperationWorkflow(
  operation: CatalogOperation,
) {
  if (!operation.workflowRunId) return;
  try {
    const run = getRun(operation.workflowRunId);
    if (await run.exists) await run.cancel();
  } catch (error) {
    console.warn("Unable to cancel durable catalog workflow run", {
      operationId: operation.id,
      workflowRunId: operation.workflowRunId,
      error,
    });
  }
}

export const cancelCatalogSnapshotWorkflow = cancelCatalogOperationWorkflow;
