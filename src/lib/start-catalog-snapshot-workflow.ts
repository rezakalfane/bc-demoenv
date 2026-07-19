import { getRun, start } from "workflow/api";
import {
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

export async function reconcileCatalogOperationWorkflow(
  userId: string,
  operation: CatalogOperation,
) {
  if (
    !operation.workflowRunId ||
    !["queued", "running"].includes(operation.status)
  ) {
    return;
  }

  try {
    const run = getRun<unknown>(operation.workflowRunId);
    if (!(await run.exists)) {
      await updateCatalogOperation(userId, operation.id, {
        status: "failed",
        currentStep: "Failed",
        error: "The durable catalog workflow run was not found.",
      });
      return;
    }

    const status = await run.status;
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
