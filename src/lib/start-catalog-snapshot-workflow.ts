import { getRun, start } from "workflow/api";
import {
  type CatalogOperation,
  updateCatalogOperation,
} from "@/lib/db";
import { catalogSnapshotWorkflow } from "@/workflows/catalog-snapshot";

export async function startCatalogSnapshotWorkflow(
  userId: string,
  operationId: number,
) {
  try {
    const run = await start(catalogSnapshotWorkflow, [userId, operationId]);
    await updateCatalogOperation(userId, operationId, {
      workflowRunId: run.runId,
    });
    return run.runId;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "The durable snapshot workflow could not be started.";
    await updateCatalogOperation(userId, operationId, {
      status: "failed",
      currentStep: "Failed",
      error: message,
    });
    throw error;
  }
}

export async function reconcileCatalogSnapshotWorkflow(
  userId: string,
  operation: CatalogOperation,
) {
  if (
    operation.kind !== "snapshot" ||
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
        error: "The durable snapshot workflow run was not found.",
      });
      return;
    }

    const status = await run.status;
    if (status === "running" && operation.status === "queued") {
      await updateCatalogOperation(userId, operation.id, {
        status: "running",
        currentStep: "Starting durable snapshot capture",
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
      let message = "The durable snapshot workflow failed before completing.";
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
    console.warn("Unable to reconcile durable snapshot workflow status", {
      operationId: operation.id,
      workflowRunId: operation.workflowRunId,
      error,
    });
  }
}

export async function cancelCatalogSnapshotWorkflow(
  operation: CatalogOperation,
) {
  if (operation.kind !== "snapshot" || !operation.workflowRunId) return;
  try {
    const run = getRun(operation.workflowRunId);
    if (await run.exists) await run.cancel();
  } catch (error) {
    console.warn("Unable to cancel durable snapshot workflow run", {
      operationId: operation.id,
      workflowRunId: operation.workflowRunId,
      error,
    });
  }
}
